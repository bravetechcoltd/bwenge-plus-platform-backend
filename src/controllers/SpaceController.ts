// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Course } from "../database/models/Course";
import { Space, SpaceType } from "../database/models/SpaceModel";
import { User } from "../database/models/User";
import { SpaceMember } from "../database/models/SpaceMemberModel";
import { SpaceMessage } from "../database/models/SpaceMessageModel";
import { logActivity } from "../middleware/ActivityLog";
import { io } from "../index";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { isInstitutionAdmin, isMemberOfInstitution } from "../utils/institutionChatGuard";

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

// Create space (supports both course spaces and institution spaces)
export const createSpace = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space);
  const courseRepo = dbConnection.getRepository(Course);
  const memberRepo = dbConnection.getRepository(SpaceMember);
  const institutionMemberRepo = dbConnection.getRepository(InstitutionMember);
  const customReq = req as CustomRequest;

  const { courseId, institutionId, name, spaceType = SpaceType.COURSE_SPACE } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let space: Space;
    let institutionMembers: InstitutionMember[] = [];

    if (spaceType === SpaceType.COURSE_SPACE) {
      // Validate course exists
      if (!courseId) {
        return res.status(400).json({ message: "courseId is required for course spaces" });
      }

      const course = await courseRepo.findOne({
        where: { id: courseId },
        relations: ["instructor", "institution"],
      });

      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      // Check if space already exists for this course
      const existingSpace = await spaceRepo.findOne({
        where: { courseId, spaceType: SpaceType.COURSE_SPACE },
      });

      if (existingSpace) {
        return res.status(400).json({ message: "A space already exists for this course" });
      }

      // Verify permission to create space (instructor or institution admin)
      const isInstructor = course.instructor?.id === customReq.user.id;
      const isAdmin = course.institutionId 
        ? await isInstitutionAdmin(customReq.user.id, course.institutionId)
        : false;

      if (!isInstructor && !isAdmin) {
        return res.status(403).json({ message: "Only instructors or institution admins can create course spaces" });
      }

      // Create course space
      space = spaceRepo.create({
        spaceType: SpaceType.COURSE_SPACE,
        course: { id: courseId },
        courseId: courseId,
        name: null,
      });

      await spaceRepo.save(space);

      // Add all enrolled students and instructors as members
      const enrolledStudents = await dbConnection
        .createQueryBuilder()
        .select("enrollment.user_id")
        .from("enrollments", "enrollment")
        .where("enrollment.course_id = :courseId", { courseId })
        .andWhere("enrollment.status = :status", { status: "APPROVED" })
        .getRawMany();

      const membersToAdd = new Set<string>();

      // Add instructor
      if (course.instructor?.id) {
        membersToAdd.add(course.instructor.id);
      }

      // Add all course instructors from CourseInstructor table
      const courseInstructors = await dbConnection
        .createQueryBuilder()
        .select("ci.instructor_id")
        .from("course_instructors", "ci")
        .where("ci.course_id = :courseId", { courseId })
        .getRawMany();

      courseInstructors.forEach(ci => {
        if (ci.instructor_id) membersToAdd.add(ci.instructor_id);
      });

      // Add enrolled students
      enrolledStudents.forEach(es => {
        if (es.user_id) membersToAdd.add(es.user_id);
      });

      // Create space members
      for (const userId of membersToAdd) {
        const existingMember = await memberRepo.findOne({
          where: { spaceId: space.id, userId },
        });
        if (!existingMember) {
          const member = memberRepo.create({
            space: { id: space.id },
            user: { id: userId },
          });
          await memberRepo.save(member);
        }
      }

    } else if (spaceType === SpaceType.INSTITUTION_SPACE) {
      // Validate institution exists
      if (!institutionId) {
        return res.status(400).json({ message: "institutionId is required for institution spaces" });
      }

      // Check if institution already has a space
      const existingSpace = await spaceRepo.findOne({
        where: { institutionId, spaceType: SpaceType.INSTITUTION_SPACE },
      });

      if (existingSpace) {
        return res.status(400).json({ message: "This institution already has a space" });
      }

      // Verify user is institution admin
      const isAdmin = await isInstitutionAdmin(customReq.user.id, institutionId);
      if (!isAdmin) {
        return res.status(403).json({ message: "Only institution admins can create institution spaces" });
      }

      // Create institution space
      space = spaceRepo.create({
        spaceType: SpaceType.INSTITUTION_SPACE,
        institution: { id: institutionId },
        institutionId: institutionId,
        name: name || "General",
      });

      await spaceRepo.save(space);

      // Get all active institution members
      institutionMembers = await institutionMemberRepo.find({
        where: { institution_id: institutionId, is_active: true },
      });

      // Add all institution members as space members
      for (const member of institutionMembers) {
        const existingMember = await memberRepo.findOne({
          where: { spaceId: space.id, userId: member.user_id },
        });
        if (!existingMember) {
          const spaceMember = memberRepo.create({
            space: { id: space.id },
            user: { id: member.user_id },
          });
          await memberRepo.save(spaceMember);
        }
      }
    } else {
      return res.status(400).json({ message: "Invalid space type" });
    }

    await logActivity({
      userId: customReq.user.id,
      action: "Create Space",
      targetId: String(space.id),
      targetType: "Space",
      details: `Created ${spaceType} space ${space.id} by ${customReq.user.first_name} ${customReq.user.last_name}`,
    });

    // Fetch complete space with relations
    const completeSpace = await spaceRepo.findOne({
      where: { id: space.id },
      relations: ["course", "institution", "members", "members.user"],
    });

    res.status(201).json({
      success: true,
      data: completeSpace,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create space" });
  }
};

// Get space with messages (supports pagination)
export const getSpace = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space);
  const { spaceId } = req.params;

  try {
    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["messages", "messages.sender", "course", "institution", "members", "members.user"],
      order: {
        messages: { createdAt: "ASC" },
      },
    });

    if (!space) return res.status(404).json({ message: "Space not found" });

    res.json({
      success: true,
      data: space,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch space" });
  }
};

// Get space messages with pagination
export const getSpaceMessages = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(SpaceMessage);
  const { spaceId } = req.params;
  const { limit = 50, before } = req.query;

  try {
    let query = messageRepo
      .createQueryBuilder("message")
      .leftJoinAndSelect("message.sender", "sender")
      .where("message.spaceId = :spaceId", { spaceId })
      .andWhere("message.deletedAt IS NULL")  // exclude soft-deleted
      .orderBy("message.createdAt", "DESC");

    if (before) {
      query = query.andWhere("message.createdAt < :before", { before });
    }

    const messages = await query.take(Number(limit)).getMany();

    // Reverse for chronological order
    res.json({
      success: true,
      data: messages.reverse(),
      pagination: {
        limit: Number(limit),
        hasMore: messages.length === Number(limit),
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch space messages" });
  }
};

// Get space by course
export const getSpaceByCourse = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space);
  const { courseId } = req.params;

  try {
    const spaces = await spaceRepo.find({
      where: { course: { id: courseId } },
      relations: ["messages", "messages.sender", "course", "members", "members.user"],
      order: {
        messages: { createdAt: "ASC" },
      },
    });

    res.json({
      success: true,
      data: spaces,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch spaces" });
  }
};

export const getSpacesByMember = async (req: Request, res: Response) => {
  const memberRepo = dbConnection.getRepository(SpaceMember);
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const memberships = await memberRepo.find({
      where: {
        user: { id: customReq.user.id },
      },
      relations: [
        "space",
        "space.course",
        "space.course.instructor",
        "space.members",
        "space.members.user",
        "space.messages",
        "space.messages.sender",
      ],
      order: {
        space: {
          createdAt: "DESC",
        },
      },
    });

    // Filter out spaces that might have missing data
    const spaces = memberships
      .map(m => m.space)
      .filter(space => space !== null)
      .map(space => ({
        ...space,
        // Provide default values for missing fields
        institutionId: space.institutionId || null,
        name: space.name || null,
        spaceType: space.spaceType || 'COURSE_SPACE',
      }));

    res.status(200).json({
      success: true,
      message: "User spaces fetched",
      data: spaces,
    });
  } catch (err) {
    // Fallback to simpler query if the relation query fails
    try {
      const simpleMemberships = await memberRepo.find({
        where: {
          user: { id: customReq.user.id },
        },
        relations: ["space"],
      });
      
      const spaces = simpleMemberships.map(m => m.space);
      
      res.status(200).json({
        success: true,
        message: "User spaces fetched (simplified)",
        data: spaces,
      });
    } catch (fallbackErr) {
      res.status(500).json({ 
        success: false, 
        message: "Failed to fetch spaces",
        data: [] 
      });
    }
  }
};

// Update space
export const updateSpace = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space);
  const customReq = req as CustomRequest;
  const { spaceId } = req.params;
  const { name } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["course", "course.instructor", "institution"],
    });

    if (!space) return res.status(404).json({ message: "Space not found" });

    let isAuthorized = false;

    if (space.spaceType === SpaceType.COURSE_SPACE && space.course) {
      isAuthorized = space.course.instructor?.id === customReq.user.id;
      if (space.course.institutionId) {
        isAuthorized = isAuthorized || await isInstitutionAdmin(customReq.user.id, space.course.institutionId);
      }
    } else if (space.spaceType === SpaceType.INSTITUTION_SPACE && space.institutionId) {
      isAuthorized = await isInstitutionAdmin(customReq.user.id, space.institutionId);
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to update this space" });
    }

    if (name !== undefined && space.spaceType === SpaceType.INSTITUTION_SPACE) {
      space.name = name;
    }

    await spaceRepo.save(space);

    await logActivity({
      userId: customReq.user.id,
      action: "Update Space",
      targetId: String(space.id),
      targetType: "Space",
      details: `Updated space ${space.id} by ${customReq.user.first_name} ${customReq.user.last_name}`,
    });

    res.json({
      success: true,
      data: space,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to update space" });
  }
};

// Delete space
export const deleteSpace = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space);
  const customReq = req as CustomRequest;
  const { spaceId } = req.params;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["course", "course.instructor", "institution"],
    });

    if (!space) return res.status(404).json({ message: "Space not found" });

    let isAuthorized = false;

    if (space.spaceType === SpaceType.COURSE_SPACE && space.course) {
      isAuthorized = space.course.instructor?.id === customReq.user.id;
      if (space.course.institutionId) {
        isAuthorized = isAuthorized || await isInstitutionAdmin(customReq.user.id, space.course.institutionId);
      }
    } else if (space.spaceType === SpaceType.INSTITUTION_SPACE && space.institutionId) {
      isAuthorized = await isInstitutionAdmin(customReq.user.id, space.institutionId);
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to delete this space" });
    }

    const spaceIdStr = space.id;
    await spaceRepo.remove(space);

    await logActivity({
      userId: customReq.user.id,
      action: "Delete Space",
      targetId: String(spaceIdStr),
      targetType: "Space",
      details: `Deleted space ${spaceIdStr} by ${customReq.user.first_name} ${customReq.user.last_name}`,
    });

    res.json({
      success: true,
      message: "Space deleted",
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete space" });
  }
};

// Add member to space (updated with proper authorization)
export const addMemberToSpace = async (req: Request, res: Response) => {
  const memberRepo = dbConnection.getRepository(SpaceMember);
  const spaceRepo = dbConnection.getRepository(Space);
  const userRepo = dbConnection.getRepository(User);
  const customReq = req as CustomRequest;

  const { spaceId, userId } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["course", "course.instructor", "institution"],
    });

    if (!space) return res.status(404).json({ message: "Space not found" });

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: "User not found" });

    let isAuthorized = false;

    if (space.spaceType === SpaceType.COURSE_SPACE && space.course) {
      // Course space: instructor or institution admin can add members
      isAuthorized = space.course.instructor?.id === customReq.user.id;
      if (space.course.institutionId) {
        isAuthorized = isAuthorized || await isInstitutionAdmin(customReq.user.id, space.course.institutionId);
      }
    } else if (space.spaceType === SpaceType.INSTITUTION_SPACE && space.institutionId) {
      // Institution space: only institution admin can add members
      isAuthorized = await isInstitutionAdmin(customReq.user.id, space.institutionId);
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to add members to this space" });
    }

    // Check if user is a member of the institution (for institution spaces)
    if (space.spaceType === SpaceType.INSTITUTION_SPACE && space.institutionId) {
      const isMember = await isMemberOfInstitution(userId, space.institutionId);
      if (!isMember) {
        return res.status(403).json({ message: "User must be a member of the institution to join this space" });
      }
    }

    // Check if already a member
    const existing = await memberRepo.findOne({
      where: {
        space: { id: spaceId },
        user: { id: userId },
      },
    });

    if (existing) {
      return res.status(400).json({ message: "User already in space" });
    }

    const member = memberRepo.create({
      space: { id: spaceId },
      user: { id: userId },
    });

    await memberRepo.save(member);

    await logActivity({
      userId: userId,
      action: "Join Space",
      targetId: String(space.id),
      targetType: "Space",
      details: `User ${user.first_name} ${user.last_name} was added to space ${space.id}`,
    });

    res.status(201).json({
      success: true,
      message: "Member added to space",
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to add member" });
  }
};

// Remove member from space
export const removeMemberFromSpace = async (req: Request, res: Response) => {
  const memberRepo = dbConnection.getRepository(SpaceMember);
  const customReq = req as CustomRequest;
  const spaceRepo = dbConnection.getRepository(Space);

  const { spaceId, userId } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["course", "course.instructor", "institution"],
    });

    if (!space) return res.status(404).json({ message: "Space not found" });

    let isAuthorized = false;

    if (space.spaceType === SpaceType.COURSE_SPACE && space.course) {
      isAuthorized = space.course.instructor?.id === customReq.user.id;
      if (space.course.institutionId) {
        isAuthorized = isAuthorized || await isInstitutionAdmin(customReq.user.id, space.course.institutionId);
      }
    } else if (space.spaceType === SpaceType.INSTITUTION_SPACE && space.institutionId) {
      isAuthorized = await isInstitutionAdmin(customReq.user.id, space.institutionId);
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to remove members from this space" });
    }

    const member = await memberRepo.findOne({
      where: {
        space: { id: spaceId },
        user: { id: userId },
      },
      relations: ["user"],
    });

    if (!member) {
      return res.status(404).json({ message: "Member not found in space" });
    }

    await memberRepo.remove(member);

    await logActivity({
      userId: userId,
      action: "Leave Space",
      targetId: String(spaceId),
      targetType: "Space",
      details: `User ${member.user?.first_name} ${member.user?.last_name} was removed from space ${spaceId}`,
    });

    res.status(200).json({
      success: true,
      message: "Member removed from space",
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove member" });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(SpaceMessage);
  const spaceRepo = dbConnection.getRepository(Space);
  const customReq = req as CustomRequest;

  const { spaceId, content, attachmentUrl } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!spaceId || (!content && !attachmentUrl)) {
      return res.status(400).json({ message: "Missing spaceId or content/attachment" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["members", "members.user", "course", "course.institution", "institution"],
    });

    if (!space) {
      return res.status(404).json({ message: "Space not found" });
    }

    const isMember = space.members?.some(m => m.user?.id === customReq.user!.id);
    if (!isMember) {
      return res.status(403).json({ message: "Not a member of this space" });
    }

    if (space.spaceType === SpaceType.INSTITUTION_SPACE && space.institutionId) {
      const isInstMember = await isMemberOfInstitution(customReq.user.id, space.institutionId);
      if (!isInstMember) {
        return res.status(403).json({ message: "Must be a member of the institution to post in this space" });
      }
    }

    const senderId = customReq.user.id;

    // Get sender details for the response
    const userRepo = dbConnection.getRepository(User);
    const sender = await userRepo.findOne({
      where: { id: senderId },
      select: ["id", "first_name", "last_name", "profile_picture_url", "email"]
    });

    const message = messageRepo.create({
      space: { id: spaceId },
      sender: { id: senderId },
      content: content || "",
      attachmentUrl: attachmentUrl || null,
      status: "sent",
    });

    await messageRepo.save(message);

    await logActivity({
      userId: senderId,
      action: "Sent a message",
      targetId: String(space.id),
      targetType: "Space",
      details: `Message sent in space ${space.id}`,
    });

    const completeMessage = await messageRepo.findOne({
      where: { id: message.id },
      relations: ["sender"],
    });

    const messageWithSender = {
      id: message.id,
      spaceId: space.id,
      senderId: senderId,
      content: content,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isRead: false,
      readAt: null,
      attachmentUrl: null,
      status: "sent",
      sender: sender ? {
        id: sender.id,
        first_name: sender.first_name,
        last_name: sender.last_name,
        profile_picture_url: sender.profile_picture_url,
        email: sender.email,
      } : null
    };

    if (io) {
      try {
        
        const room = io.to(`space-${spaceId}`);
        
        // Check if there are any sockets in the room
        const roomSockets = await io.in(`space-${spaceId}`).fetchSockets();
        
        if (roomSockets.length > 0) {
          room.emit("new-space-message", messageWithSender);
        } else {
        }
      } catch (emitError) {
      }
    } else {
    }

    res.status(201).json({
      success: true,
      message: "Message sent",
      data: completeMessage,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to send message" });
  }
};

// ── Enhancement #9: Edit space message ───────────────────────────────────────

export const editSpaceMessage = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(SpaceMessage);
  const { messageId } = req.params;
  const { content } = req.body;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });
    if (!content?.trim()) return res.status(400).json({ message: "Content required" });

    const message = await messageRepo.findOne({ where: { id: messageId } });
    if (!message) return res.status(404).json({ message: "Message not found" });
    if (message.senderId !== customReq.user.id) return res.status(403).json({ message: "Not your message" });

    message.content = content.trim();
    message.isEdited = true;
    await messageRepo.save(message);

    const payload = { messageId, spaceId: message.spaceId, content: message.content, isEdited: true };
    if (io) io.to(`space-${message.spaceId}`).emit("space-message-edited", payload);

    res.json({ success: true, data: message });
  } catch (err) {
    res.status(500).json({ message: "Failed to edit message" });
  }
};

// ── Enhancement #9: Delete space message ─────────────────────────────────────

export const deleteSpaceMessage = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(SpaceMessage);
  const { messageId } = req.params;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });

    const message = await messageRepo.findOne({ where: { id: messageId } });
    if (!message) return res.status(404).json({ message: "Message not found" });
    if (message.senderId !== customReq.user.id) return res.status(403).json({ message: "Not your message" });

    const { spaceId } = message;
    // Soft-delete: stamp deletedAt instead of hard remove
    message.deletedAt = new Date();
    await messageRepo.save(message);

    const payload = { messageId, spaceId };
    if (io) io.to(`space-${spaceId}`).emit("space-message-deleted", payload);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete message" });
  }
};

// ── Enhancement #5: Search space messages ────────────────────────────────────

export const searchSpaceMessages = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(SpaceMessage);
  const { spaceId } = req.params;
  const { q } = req.query;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });
    if (!q || !(q as string).trim()) return res.status(400).json({ message: "Query required" });

    const messages = await messageRepo
      .createQueryBuilder("msg")
      .leftJoinAndSelect("msg.sender", "sender")
      .where("msg.spaceId = :spaceId", { spaceId })
      .andWhere("msg.deletedAt IS NULL")
      .andWhere("LOWER(msg.content) LIKE LOWER(:q)", { q: `%${(q as string).trim()}%` })
      .orderBy("msg.createdAt", "ASC")
      .getMany();

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ message: "Failed to search messages" });
  }
};