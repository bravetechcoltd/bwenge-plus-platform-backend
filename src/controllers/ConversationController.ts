// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Conversation, ConversationType, normalizeParticipants } from "../database/models/ConversationModel";
import { Message } from "../database/models/MessageModel";
import { Course } from "../database/models/Course";
import { User } from "../database/models/User";
import { Enrollment, EnrollmentStatus, EnrollmentApprovalStatus } from "../database/models/Enrollment";
import { logActivity } from "../middleware/ActivityLog";
import { emitToUser } from "../socket/socketEmitter";

export interface CustomRequest extends Request {
  user?: {
    userId: string;
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
    bwenge_role?: string;
  };
}

// Create a new conversation
export const createConversation = async (req: Request, res: Response) => {
  const convoRepo = dbConnection.getRepository(Conversation);
  const courseRepo = dbConnection.getRepository(Course);
  const userRepo = dbConnection.getRepository(User);
  const enrollmentRepo = dbConnection.getRepository(Enrollment);
  const customReq = req as CustomRequest;

  const { courseId, instructorId, studentId, conversationType = ConversationType.DIRECT } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const currentUserId = customReq.user.id;

    // Determine participants based on user type
    let participantOneId: string;
    let participantTwoId: string;
    let actualCourseId: string | null = courseId || null;
    let studentIdValue: string | null = null;
    let instructorIdValue: string | null = null;

    // For student-instructor conversations
    if (instructorId && studentId) {
      participantOneId = studentId;
      participantTwoId = instructorId;
      studentIdValue = studentId;
      instructorIdValue = instructorId;
    } 
    // For current user creating with another user
    else if (instructorId && !studentId) {
      // Current user is student, creating with instructor
      participantOneId = currentUserId;
      participantTwoId = instructorId;
      studentIdValue = currentUserId;
      instructorIdValue = instructorId;
    }
    else if (studentId && !instructorId) {
      // Current user is instructor, creating with student
      participantOneId = currentUserId;
      participantTwoId = studentId;
      studentIdValue = studentId;
      instructorIdValue = currentUserId;
    }
    else {
      return res.status(400).json({ message: "Invalid participants" });
    }

    // Validate instructor if course is provided
    if (courseId) {
      const course = await courseRepo.findOne({
        where: { id: courseId },
        relations: ["instructor", "course_instructors", "course_instructors.instructor"],
      });

      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      // Check if the target instructor is either the primary instructor or an additional instructor
      const isPrimaryInstructor = course.instructor?.id === participantTwoId;
      const isAdditionalInstructor = course.course_instructors?.some(
        ci => ci.instructor?.id === participantTwoId
      );

      if (!isPrimaryInstructor && !isAdditionalInstructor) {
        return res.status(403).json({ 
          message: "The specified instructor is not assigned to this course" 
        });
      }

      // Verify that the student has some relationship with the course
      if (participantOneId !== course.instructor?.id) {
        // Check for any enrollment (active, completed, pending, etc.)
        const enrollment = await enrollmentRepo.findOne({
          where: {
            course_id: courseId,
            user_id: participantOneId,
          },
        });

        if (!enrollment) {
          // Also check if the user is a course instructor
          const isCourseInstructor = course.course_instructors?.some(
            ci => ci.instructor?.id === participantOneId
          );
          
          if (!isCourseInstructor) {
            return res.status(403).json({ 
              message: "Student is not enrolled in this course or does not have permission to message instructors" 
            });
          }
        } else {
          // Log the enrollment status for debugging
          
          // Allow conversation creation for:
          // 1. Active enrollments
          // 2. Completed enrollments (students may need to ask questions after completion)
          // 3. Pending enrollments that are approved
          // 4. Enrollments that require approval but are pending (student might need to ask questions)
          const allowedStatuses = [
            EnrollmentStatus.ACTIVE,
            EnrollmentStatus.COMPLETED,
          ];
          
          const isAllowed = 
            allowedStatuses.includes(enrollment.status) ||
            (enrollment.status === EnrollmentStatus.PENDING && 
             enrollment.approval_status === EnrollmentApprovalStatus.APPROVED) ||
            (enrollment.requires_approval === true && enrollment.status === EnrollmentStatus.PENDING);
          
          if (!isAllowed) {
            return res.status(403).json({ 
              message: `Student enrollment is not active or completed. Current status: ${enrollment.status}. Please contact support for assistance.`,
              enrollment_status: enrollment.status,
              approval_status: enrollment.approval_status
            });
          }
          
        }
      }
    }

    // Normalize participant ordering
    const [p1, p2] = normalizeParticipants(participantOneId, participantTwoId);

    // Check if conversation already exists
    const existingConversation = await convoRepo.findOne({
      where: {
        participantOneId: p1,
        participantTwoId: p2,
        courseId: actualCourseId,
      },
      relations: ["participantOne", "participantTwo", "course"],
    });

    if (existingConversation) {
      return res.status(200).json({
        success: true,
        conversation: existingConversation,
        existing: true,
      });
    }

    // Create new conversation with both old and new columns
    const conversation = convoRepo.create({
      participantOneId: p1,
      participantTwoId: p2,
      courseId: actualCourseId,
      conversationType,
      studentId: studentIdValue, // Set old column for backward compatibility
      instructorId: instructorIdValue, // Set old column for backward compatibility
    });

    await convoRepo.save(conversation);

    // Fetch with relations
    const completeConversation = await convoRepo.findOne({
      where: { id: conversation.id },
      relations: ["participantOne", "participantTwo", "course"],
    });

    await logActivity({
      userId: currentUserId,
      action: "Create Conversation",
      targetId: String(conversation.id),
      targetType: "Conversation",
      details: `Created conversation with ${participantTwoId}`,
    });

    // ── Real-time: Notify both participants of the new conversation ────────
    if (completeConversation) {
      emitToUser(p1, "new-conversation", completeConversation);
      emitToUser(p2, "new-conversation", completeConversation);
    }

    res.status(201).json({
      success: true,
      conversation: completeConversation,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create conversation" });
  }
};
// Get all conversations for current user
export const getConversations = async (req: Request, res: Response) => {
  const convoRepo = dbConnection.getRepository(Conversation);
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = customReq.user.id;

    const conversations = await convoRepo
      .createQueryBuilder("conversation")
      .leftJoinAndSelect("conversation.participantOne", "participantOne")
      .leftJoinAndSelect("conversation.participantTwo", "participantTwo")
      .leftJoinAndSelect("conversation.course", "course")
      .leftJoinAndSelect("conversation.messages", "messages")
      .leftJoinAndSelect("messages.sender", "msgSender")
      .where("conversation.participantOneId = :userId OR conversation.participantTwoId = :userId", { userId })
      .orderBy("conversation.updatedAt", "DESC")
      .getMany();

    // ── Enhancement #4: DB subquery for accurate unread counts ────────────────
    const messageRepo = dbConnection.getRepository(Message);
    const convIds = conversations.map((c) => c.id);

    let unreadMap = new Map<string, number>();
    if (convIds.length > 0) {
      const counts = await messageRepo
        .createQueryBuilder("msg")
        .select("msg.conversationId", "conversationId")
        .addSelect("COUNT(*)", "count")
        .where("msg.conversationId IN (:...ids)", { ids: convIds })
        .andWhere("msg.senderId != :userId", { userId })
        .andWhere("msg.isRead = false")
        .groupBy("msg.conversationId")
        .getRawMany();
      unreadMap = new Map(counts.map((r) => [r.conversationId, parseInt(r.count, 10)]));
    }

    // Sanitize conversations for frontend
    const sanitized = conversations.map((conv) => ({
      id: conv.id,
      otherUser: conv.getOtherUser(userId),
      courseId: conv.courseId,
      courseTitle: conv.course?.title,
      conversationType: conv.conversationType,
      lastMessage: conv.getLastMessage(),
      unreadCount: unreadMap.get(conv.id) ?? 0,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));

    res.status(200).json({
      success: true,
      conversations: sanitized,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch conversations" });
  }
};

// Get user conversation in a specific course
export const getUserConvoInCourse = async (req: Request, res: Response) => {
  const convoRepo = dbConnection.getRepository(Conversation);
  const customReq = req as CustomRequest;
  const { courseId } = req.params;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = customReq.user.id;

    const conversation = await convoRepo
      .createQueryBuilder("conversation")
      .leftJoinAndSelect("conversation.participantOne", "participantOne")
      .leftJoinAndSelect("conversation.participantTwo", "participantTwo")
      .leftJoinAndSelect("conversation.course", "course")
      .where("conversation.courseId = :courseId", { courseId })
      .andWhere("(conversation.participantOneId = :userId OR conversation.participantTwoId = :userId)", { userId })
      .getOne();

    if (!conversation) {
      return res.status(404).json({ message: "No conversation found for this course" });
    }

    res.status(200).json({
      success: true,
      conversation: {
        id: conversation.id,
        otherUser: conversation.getOtherUser(userId),
        courseId: conversation.courseId,
        courseTitle: conversation.course?.title,
        conversationType: conversation.conversationType,
        messages: conversation.messages,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch conversation" });
  }
};