// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { SavedCourse } from "../database/models/SavedCourse";
import { User } from "../database/models/User";
import { Course } from "../database/models/Course";
import { BwengeRole } from "../database/models/User";

export class SavedCourseController {
  
  // ==================== GET USER'S SAVED COURSES ====================
  static async getUserSavedCourses(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const requestingUserId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      // Check permissions - users can only view their own saved courses
      if (requestingUserId !== userId) {
        const userRepo = dbConnection.getRepository(User);
        const requestingUser = await userRepo.findOne({ where: { id: requestingUserId } });
        
        if (requestingUser?.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to view this user's saved courses",
          });
        }
      }

      const savedRepo = dbConnection.getRepository(SavedCourse);
      
      const savedCourses = await savedRepo.find({
        where: { user_id: userId },
        relations: [
          "course",
          "course.instructor",
          "course.institution",
          "course.course_category",
        ],
        order: { saved_at: "DESC" },
      });

      // Transform data for frontend
      const transformed = savedCourses.map(saved => ({
        id: saved.course.id,
        saved_id: saved.id,
        title: saved.course.title,
        description: saved.course.description,
        thumbnail_url: saved.course.thumbnail_url,
        course_type: saved.course.course_type,
        level: saved.course.level,
        price: saved.course.price,
        average_rating: saved.course.average_rating,
        total_reviews: saved.course.total_reviews,
        enrollment_count: saved.course.enrollment_count,
        duration_minutes: saved.course.duration_minutes,
        language: saved.course.language,
        is_certificate_available: saved.course.is_certificate_available,
        instructor: saved.course.instructor ? {
          id: saved.course.instructor.id,
          name: `${saved.course.instructor.first_name} ${saved.course.instructor.last_name}`.trim(),
          avatar: saved.course.instructor.profile_picture_url,
        } : {
          id: "",
          name: "Unknown Instructor",
          avatar: null,
        },
        institution: saved.course.institution ? {
          id: saved.course.institution.id,
          name: saved.course.institution.name,
          logo: saved.course.institution.logo_url,
        } : undefined,
        saved_at: saved.saved_at,
        notes: saved.notes,
        tags: saved.tags,
      }));

      res.json({
        success: true,
        data: transformed,
        total: transformed.length,
      });
    } catch (error: any) {
      console.error("❌ Get user saved courses error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch saved courses",
        error: error.message,
      });
    }
  }

  // ==================== SAVE COURSE ====================
  static async saveCourse(req: Request, res: Response) {
    try {
      const { course_id, notes, tags } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      // Verify course exists
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id: course_id } });
      
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const savedRepo = dbConnection.getRepository(SavedCourse);

      // Check if already saved
      const existing = await savedRepo.findOne({
        where: { user_id: userId, course_id },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Course already saved",
        });
      }

      // Create new saved course
      const savedCourse = savedRepo.create({
        user_id: userId,
        course_id,
        notes: notes || null,
        tags: tags || null,
      });

      await savedRepo.save(savedCourse);

      // Fetch the complete saved course with relations
      const savedWithRelations = await savedRepo.findOne({
        where: { id: savedCourse.id },
        relations: [
          "course",
          "course.instructor",
          "course.institution",
          "course.course_category",
        ],
      });

      // Transform for response
      const transformed = {
        id: savedWithRelations!.course.id,
        saved_id: savedWithRelations!.id,
        title: savedWithRelations!.course.title,
        description: savedWithRelations!.course.description,
        thumbnail_url: savedWithRelations!.course.thumbnail_url,
        course_type: savedWithRelations!.course.course_type,
        level: savedWithRelations!.course.level,
        price: savedWithRelations!.course.price,
        average_rating: savedWithRelations!.course.average_rating,
        total_reviews: savedWithRelations!.course.total_reviews,
        enrollment_count: savedWithRelations!.course.enrollment_count,
        duration_minutes: savedWithRelations!.course.duration_minutes,
        language: savedWithRelations!.course.language,
        is_certificate_available: savedWithRelations!.course.is_certificate_available,
        instructor: savedWithRelations!.course.instructor ? {
          id: savedWithRelations!.course.instructor.id,
          name: `${savedWithRelations!.course.instructor.first_name} ${savedWithRelations!.course.instructor.last_name}`.trim(),
          avatar: savedWithRelations!.course.instructor.profile_picture_url,
        } : {
          id: "",
          name: "Unknown Instructor",
          avatar: null,
        },
        institution: savedWithRelations!.course.institution ? {
          id: savedWithRelations!.course.institution.id,
          name: savedWithRelations!.course.institution.name,
          logo: savedWithRelations!.course.institution.logo_url,
        } : undefined,
        saved_at: savedWithRelations!.saved_at,
        notes: savedWithRelations!.notes,
        tags: savedWithRelations!.tags,
      };

      res.status(201).json({
        success: true,
        message: "Course saved successfully",
        data: transformed,
      });
    } catch (error: any) {
      console.error("❌ Save course error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to save course",
        error: error.message,
      });
    }
  }

  // ==================== UNSAVE COURSE ====================
  static async unsaveCourse(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      const savedRepo = dbConnection.getRepository(SavedCourse);
      
      const savedCourse = await savedRepo.findOne({
        where: { id },
        relations: ["user"],
      });

      if (!savedCourse) {
        return res.status(404).json({
          success: false,
          message: "Saved course not found",
        });
      }

      // Check ownership
      if (savedCourse.user_id !== userId) {
        const userRepo = dbConnection.getRepository(User);
        const user = await userRepo.findOne({ where: { id: userId } });
        
        if (user?.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to unsave this course",
          });
        }
      }

      await savedRepo.remove(savedCourse);

      res.json({
        success: true,
        message: "Course removed from saved",
      });
    } catch (error: any) {
      console.error("❌ Unsave course error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to unsave course",
        error: error.message,
      });
    }
  }

  // ==================== UPDATE NOTES ====================
  static async updateNotes(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const userId = req.user?.userId || req.user?.id;

      const savedRepo = dbConnection.getRepository(SavedCourse);
      
      const savedCourse = await savedRepo.findOne({
        where: { id },
      });

      if (!savedCourse) {
        return res.status(404).json({
          success: false,
          message: "Saved course not found",
        });
      }

      // Check ownership
      if (savedCourse.user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this saved course",
        });
      }

      savedCourse.notes = notes;
      await savedRepo.save(savedCourse);

      res.json({
        success: true,
        message: "Notes updated successfully",
        data: { notes: savedCourse.notes },
      });
    } catch (error: any) {
      console.error("❌ Update notes error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update notes",
        error: error.message,
      });
    }
  }

  // ==================== CHECK IF COURSE IS SAVED ====================
  static async checkSaved(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const userId = req.user?.userId || req.user?.id;

      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const savedRepo = dbConnection.getRepository(SavedCourse);
      
      const saved = await savedRepo.findOne({
        where: { user_id: userId, course_id: courseId },
      });

      res.json({
        success: true,
        data: {
          is_saved: !!saved,
          saved_id: saved?.id,
        },
      });
    } catch (error: any) {
      console.error("❌ Check saved error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check saved status",
        error: error.message,
      });
    }
  }
}