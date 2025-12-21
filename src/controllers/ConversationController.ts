// @ts-nocheck
import { Conversation } from "../database/models/ConversationModel";
import { Course } from "../database/models/Course";
import { User, BwengeRole } from "../database/models/User";
import { CustomRequest } from "./CourseController";
import { Request, Response } from "express";
import dbConnection from "../database/db";

export const createConversation = async (req: Request, res: Response) => {
  const convoRepo = dbConnection.getRepository(Conversation);
  const courseRepo = dbConnection.getRepository(Course);
  const userRepo = dbConnection.getRepository(User);
  const customReq = req as CustomRequest;

  const { instructorId, courseId } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const studentId = customReq.user.id;

    if (!instructorId || !courseId) {
      return res.status(400).json({ message: "Missing instructorId or courseId" });
    }

    if (studentId === instructorId) {
      return res.status(400).json({ message: "You cannot message yourself" });
    }

    // ✅ FIX: Check if instructor exists (any user can be an instructor for messaging purposes)
    const instructor = await userRepo.findOne({
      where: { id: instructorId }
    });

    if (!instructor) {
      return res.status(404).json({ message: "Instructor not found" });
    }

    // ✅ FIX: Don't restrict by role - any user can message another user about a course
    const student = await userRepo.findOne({
      where: { id: studentId }
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // ✅ FIX: Verify that the instructor is actually associated with this course
    const course = await courseRepo.findOne({
      where: { id: courseId },
      relations: ["instructor", "course_instructors", "course_instructors.instructor"],
    });

    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Check if the instructor is actually associated with this course
    const isInstructorAssociated = 
      course.instructor_id === instructorId ||
      course.course_instructors?.some(ci => ci.instructor_id === instructorId);

    if (!isInstructorAssociated) {
      return res.status(403).json({ 
        message: "This instructor is not associated with the specified course" 
      });
    }

    // Check if conversation already exists
    let conversation = await convoRepo.findOne({
      where: {
        studentId: studentId,
        instructorId: instructorId,
        courseId: courseId,
      },
      relations: ["student", "instructor", "course"],
    });

    if (conversation) {
      const sanitized = {
        id: conversation.id,
        student: {
          id: conversation.student.id,
          first_name: conversation.student.first_name,
          last_name: conversation.student.last_name,
          profile_picture_url: conversation.student.profile_picture_url,
        },
        instructor: {
          id: conversation.instructor.id,
          first_name: conversation.instructor.first_name,
          last_name: conversation.instructor.last_name,
          profile_picture_url: conversation.instructor.profile_picture_url,
        },
        course: {
          id: conversation.course.id,
          title: conversation.course.title,
        },
        createdAt: conversation.createdAt,
      };

      return res.status(200).json({
        message: "Conversation already exists",
        conversation: sanitized,
      });
    }

    // Create new conversation
    conversation = convoRepo.create({
      studentId: studentId,
      instructorId: instructorId,
      courseId: courseId,
    });

    await convoRepo.save(conversation);

    const fullConversation = await convoRepo.findOne({
      where: { id: conversation.id },
      relations: ["student", "instructor", "course"],
    });

    if (!fullConversation) {
      return res.status(404).json({ message: "Conversation not found after creation" });
    }

    const sanitizedConversation = {
      id: fullConversation.id,
      student: {
        id: fullConversation.student.id,
        first_name: fullConversation.student.first_name,
        last_name: fullConversation.student.last_name,
        profile_picture_url: fullConversation.student.profile_picture_url,
      },
      instructor: {
        id: fullConversation.instructor.id,
        first_name: fullConversation.instructor.first_name,
        last_name: fullConversation.instructor.last_name,
        profile_picture_url: fullConversation.instructor.profile_picture_url,
      },
      course: {
        id: fullConversation.course.id,
        title: fullConversation.course.title,
      },
      createdAt: fullConversation.createdAt,
    };

    res.status(201).json({
      message: "Conversation created",
      conversation: sanitizedConversation,
    });
  } catch (err: any) {
    // Unique constraint violation safety net
    if (err.code === "23505" || err.message?.includes("duplicate key")) {
      try {
        const existingConversation = await convoRepo.findOne({
          where: {
            studentId: customReq.user!.id,
            instructorId: instructorId,
            courseId: courseId,
          },
          relations: ["student", "instructor", "course"],
        });

        if (existingConversation) {
          return res.status(200).json({
            message: "Conversation already exists",
            conversation: {
              id: existingConversation.id,
              student: {
                id: existingConversation.student.id,
                first_name: existingConversation.student.first_name,
                last_name: existingConversation.student.last_name,
              },
              instructor: {
                id: existingConversation.instructor.id,
                first_name: existingConversation.instructor.first_name,
                last_name: existingConversation.instructor.last_name,
              },
              course: {
                id: existingConversation.course.id,
                title: existingConversation.course.title,
              },
            },
          });
        }
      } catch (findError) {
        console.error("Error finding existing conversation:", findError);
      }
    }

    console.error("Error creating conversation:", err);
    res.status(500).json({ 
      message: "Failed to create conversation",
      error: err.message 
    });
  }
};

export const getConversations = async (req: Request, res: Response) => {
  const convoRepo = dbConnection.getRepository(Conversation);
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = customReq.user.id;

    const conversations = await convoRepo.find({
      where: [
        { studentId: userId },
        { instructorId: userId },
      ],
      relations: [
        "student",
        "instructor",
        "course",
        "messages",
        "messages.sender",
      ],
      order: {
        updatedAt: "DESC",
        messages: {
          createdAt: "ASC",
        },
      },
    });

    const sanitized = conversations.map((convo) => ({
      id: convo.id,
      student: {
        id: convo.student.id,
        first_name: convo.student.first_name,
        last_name: convo.student.last_name,
        profile_picture_url: convo.student.profile_picture_url,
        bwenge_role: convo.student.bwenge_role,
      },
      instructor: {
        id: convo.instructor.id,
        first_name: convo.instructor.first_name,
        last_name: convo.instructor.last_name,
        profile_picture_url: convo.instructor.profile_picture_url,
        bwenge_role: convo.instructor.bwenge_role,
      },
      course: {
        id: convo.course.id,
        title: convo.course.title,
      },
      lastMessage: convo.getLastMessage ? {
        id: convo.getLastMessage()?.id,
        content: convo.getLastMessage()?.content,
        createdAt: convo.getLastMessage()?.createdAt,
        senderId: convo.getLastMessage()?.senderId,
      } : null,
      unreadCount: convo.getUnreadCount ? convo.getUnreadCount(userId) : 0,
      createdAt: convo.createdAt,
      updatedAt: convo.updatedAt,
      isArchived: convo.isArchived,
    }));

    res.status(200).json({
      success: true,
      message: "Conversations fetched successfully",
      sanitized: sanitized,
    });
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch conversations",
      error: err.message 
    });
  }
};

export const getUserConvoInCourse = async (req: Request, res: Response) => {
  const convoRepo = dbConnection.getRepository(Conversation);
  const customReq = req as CustomRequest;
  const { courseId } = req.params;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = customReq.user.id;

    const conversations = await convoRepo.find({
      where: [
        { studentId: userId, courseId: courseId },
        { instructorId: userId, courseId: courseId },
      ],
      relations: ["student", "instructor", "course", "messages", "messages.sender"],
      order: {
        updatedAt: "DESC",
        messages: {
          createdAt: "ASC",
        },
      },
    });

    const sanitized = conversations.map((convo) => ({
      id: convo.id,
      student: {
        id: convo.student.id,
        first_name: convo.student.first_name,
        last_name: convo.student.last_name,
        profile_picture_url: convo.student.profile_picture_url,
      },
      instructor: {
        id: convo.instructor.id,
        first_name: convo.instructor.first_name,
        last_name: convo.instructor.last_name,
        profile_picture_url: convo.instructor.profile_picture_url,
      },
      course: {
        id: convo.course.id,
        title: convo.course.title,
      },
      messages: convo.messages.map(msg => ({
        id: msg.id,
        content: msg.content,
        senderId: msg.senderId,
        isRead: msg.isRead,
        createdAt: msg.createdAt,
      })),
      lastMessage: convo.getLastMessage ? {
        content: convo.getLastMessage()?.content,
        createdAt: convo.getLastMessage()?.createdAt,
      } : null,
      unreadCount: convo.getUnreadCount ? convo.getUnreadCount(userId) : 0,
      createdAt: convo.createdAt,
      updatedAt: convo.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: "Conversations fetched successfully",
      conversations: sanitized,
    });
  } catch (err) {
    console.error("Error fetching course conversations:", err);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch conversations",
      error: err.message 
    });
  }
};