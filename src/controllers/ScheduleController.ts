import { Request, Response } from "express";
import dbConnection from "../database/db";
import { User } from "../database/models/User";
import { Course } from "../database/models/Course";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { Lesson } from "../database/models/Lesson";
import { Assessment } from "../database/models/Assessment";
import { EventSchedule, EventType, EventStatus, RecurrencePattern } from "../database/models/EventSchedule";

export class ScheduleController {
  
  // ==================== GET INSTRUCTOR SCHEDULE ====================
  static async getInstructorSchedule(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { start_date, end_date, course_id } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Get all courses where user is instructor
      const courseRepo = dbConnection.getRepository(Course);
      const courses = await courseRepo
        .createQueryBuilder("course")
        .where(
          `(
            course.instructor_id = :userId 
            OR EXISTS (
              SELECT 1 FROM course_instructors ci 
              WHERE ci.course_id = course.id 
              AND ci.instructor_id = :userId 
              AND ci.can_edit_course_content = true
            )
          )`,
          { userId }
        )
        .getMany();

      const courseIds = courses.map(c => c.id);

      if (courseIds.length === 0) {
        return res.json({
          success: true,
          data: {
            events: [],
            courses: [],
          },
        });
      }

      // Get scheduled events from database
      const eventRepo = dbConnection.getRepository(EventSchedule);
      const queryBuilder = eventRepo
        .createQueryBuilder("event")
        .leftJoinAndSelect("event.course", "course")
        .leftJoinAndSelect("event.module", "module")
        .leftJoinAndSelect("event.lesson", "lesson")
        .leftJoinAndSelect("event.creator", "creator")
        .where("event.course_id IN (:...courseIds)", { courseIds })
        .andWhere("event.is_active = :isActive", { isActive: true });

      // Apply date filters
      if (start_date) {
        queryBuilder.andWhere("event.start_date >= :start_date", { start_date });
      }
      if (end_date) {
        queryBuilder.andWhere("event.end_date <= :end_date", { end_date });
      }

      // Apply course filter
      if (course_id) {
        queryBuilder.andWhere("event.course_id = :course_id", { course_id });
      }

      const events = await queryBuilder
        .orderBy("event.start_date", "ASC")
        .getMany();

      // Transform events for response
      const formattedEvents = events.map(event => ({
        id: event.id,
        title: event.title,
        type: event.type,
        course: {
          id: event.course.id,
          title: event.course.title,
          thumbnail_url: event.course.thumbnail_url,
        },
        module: event.module?.title,
        lesson: event.lesson?.title,
        description: event.description,
        start: event.start_date,
        end: event.end_date,
        location: event.location,
        meeting_url: event.meeting_url,
        status: event.status,
        is_recurring: event.is_recurring,
        recurrence_pattern: event.recurrence_pattern,
        created_by: {
          id: event.creator.id,
          name: `${event.creator.first_name} ${event.creator.last_name}`,
        },
      }));

      res.json({
        success: true,
        data: {
          events: formattedEvents,
          courses: courses.map(c => ({
            id: c.id,
            title: c.title,
            thumbnail_url: c.thumbnail_url,
          })),
        },
      });

    } catch (error: any) {
      console.error("❌ Get instructor schedule error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch schedule",
        error: error.message,
      });
    }
  }

  // ==================== CREATE SCHEDULE EVENT ====================
  static async createEvent(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const {
        title,
        type,
        course_id,
        module_id,
        lesson_id,
        start_date,
        end_date,
        description,
        location,
        meeting_url,
        is_recurring,
        recurrence_pattern,
        recurrence_config,
        metadata,
      } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Validate required fields
      if (!title || !type || !course_id || !start_date || !end_date) {
        return res.status(400).json({
          success: false,
          message: "Title, type, course_id, start_date, and end_date are required",
        });
      }

      // Verify course access
      const courseRepo = dbConnection.getRepository(Course);
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

      const isPrimaryInstructor = await courseRepo.findOne({
        where: { id: course_id, instructor_id: userId },
      });

      const isAdditionalInstructor = await courseInstructorRepo.findOne({
        where: { course_id, instructor_id: userId },
      });

      if (!isPrimaryInstructor && !isAdditionalInstructor) {
        return res.status(403).json({
          success: false,
          message: "You don't have access to this course",
        });
      }

      // Create event in database
      const eventRepo = dbConnection.getRepository(EventSchedule);
      const event = eventRepo.create({
        title,
        type: type as EventType,
        course_id,
        module_id: module_id || undefined,
        lesson_id: lesson_id || undefined,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        description: description || undefined,
        location: location || undefined,
        meeting_url: meeting_url || undefined,
        is_recurring: is_recurring || false,
        recurrence_pattern: recurrence_pattern ? (recurrence_pattern as RecurrencePattern) : undefined,
        recurrence_config: recurrence_config || undefined,
        status: EventStatus.SCHEDULED,
        created_by: userId,
        is_active: true,
        metadata: metadata || undefined,
      });

      await eventRepo.save(event);

      // Fetch complete event with relations
      const savedEvent = await eventRepo.findOne({
        where: { id: event.id },
        relations: ["course", "module", "lesson", "creator"],
      });

      res.status(201).json({
        success: true,
        message: "Event created successfully",
        data: {
          id: savedEvent!.id,
          title: savedEvent!.title,
          type: savedEvent!.type,
          course: {
            id: savedEvent!.course.id,
            title: savedEvent!.course.title,
          },
          module: savedEvent!.module?.title,
          lesson: savedEvent!.lesson?.title,
          start_date: savedEvent!.start_date,
          end_date: savedEvent!.end_date,
          description: savedEvent!.description,
          location: savedEvent!.location,
          meeting_url: savedEvent!.meeting_url,
          is_recurring: savedEvent!.is_recurring,
          recurrence_pattern: savedEvent!.recurrence_pattern,
          status: savedEvent!.status,
          created_at: savedEvent!.created_at,
        },
      });

    } catch (error: any) {
      console.error("❌ Create event error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create event",
        error: error.message,
      });
    }
  }

  // ==================== UPDATE EVENT ====================
  static async updateEvent(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      const updates = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Find event
      const eventRepo = dbConnection.getRepository(EventSchedule);
      const eventId = Array.isArray(id) ? id[0] : id;
      const event = await eventRepo.findOne({
        where: { id: eventId },
        relations: ["course"],
      });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      // Verify access
      const courseRepo = dbConnection.getRepository(Course);
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

      const isPrimaryInstructor = await courseRepo.findOne({
        where: { id: event.course_id, instructor_id: userId },
      });

      const isAdditionalInstructor = await courseInstructorRepo.findOne({
        where: { course_id: event.course_id, instructor_id: userId },
      });

      if (!isPrimaryInstructor && !isAdditionalInstructor && event.created_by !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this event",
        });
      }

      // Update event fields
      if (updates.title) event.title = updates.title;
      if (updates.type) event.type = updates.type as EventType;
      if (updates.description !== undefined) event.description = updates.description;
      if (updates.start_date) event.start_date = new Date(updates.start_date);
      if (updates.end_date) event.end_date = new Date(updates.end_date);
      if (updates.location !== undefined) event.location = updates.location;
      if (updates.meeting_url !== undefined) event.meeting_url = updates.meeting_url;
      if (updates.is_recurring !== undefined) event.is_recurring = updates.is_recurring;
      if (updates.recurrence_pattern !== undefined) event.recurrence_pattern = updates.recurrence_pattern as RecurrencePattern;
      if (updates.recurrence_config !== undefined) event.recurrence_config = updates.recurrence_config;
      if (updates.status) event.status = updates.status as EventStatus;
      if (updates.metadata !== undefined) event.metadata = updates.metadata;
      
      event.updated_by = userId;

      await eventRepo.save(event);

      // Fetch updated event with relations
      const updatedEvent = await eventRepo.findOne({
        where: { id: eventId },
        relations: ["course", "module", "lesson", "creator", "updater"],
      });

      res.json({
        success: true,
        message: "Event updated successfully",
        data: {
          id: updatedEvent!.id,
          title: updatedEvent!.title,
          type: updatedEvent!.type,
          course: {
            id: updatedEvent!.course.id,
            title: updatedEvent!.course.title,
          },
          start_date: updatedEvent!.start_date,
          end_date: updatedEvent!.end_date,
          description: updatedEvent!.description,
          location: updatedEvent!.location,
          meeting_url: updatedEvent!.meeting_url,
          status: updatedEvent!.status,
          updated_at: updatedEvent!.updated_at,
        },
      });

    } catch (error: any) {
      console.error("❌ Update event error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update event",
        error: error.message,
      });
    }
  }

  // ==================== DELETE EVENT ====================
  static async deleteEvent(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Find event
      const eventRepo = dbConnection.getRepository(EventSchedule);
      const eventId = Array.isArray(id) ? id[0] : id;
      const event = await eventRepo.findOne({
        where: { id: eventId },
        relations: ["course"],
      });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      // Verify access
      const courseRepo = dbConnection.getRepository(Course);
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

      const isPrimaryInstructor = await courseRepo.findOne({
        where: { id: event.course_id, instructor_id: userId },
      });

      const isAdditionalInstructor = await courseInstructorRepo.findOne({
        where: { course_id: event.course_id, instructor_id: userId },
      });

      if (!isPrimaryInstructor && !isAdditionalInstructor && event.created_by !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to delete this event",
        });
      }

      // Soft delete by setting is_active to false
      event.is_active = false;
      event.updated_by = userId;
      await eventRepo.save(event);

      res.json({
        success: true,
        message: "Event deleted successfully",
      });

    } catch (error: any) {
      console.error("❌ Delete event error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete event",
        error: error.message,
      });
    }
  }
}