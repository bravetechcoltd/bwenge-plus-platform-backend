// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Course } from "../database/models/Course"
import { Space } from "../database/models/SpaceModel"
import { User } from "../database/models/User";
import { SpaceMember } from "../database/models/SpaceMemberModel";
import { SpaceMessage } from "../database/models/SpaceMessageModel";
import { logActivity } from "../middleware/ActivityLog";

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

export const createSpace = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space)
  const courseRepo = dbConnection.getRepository(Course)
  const memberRepo = dbConnection.getRepository(SpaceMember)
  const customReq = req as CustomRequest

  const { courseId } = req.body

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const course = await courseRepo.findOne({
      where: { id: courseId },
      relations: ["instructor"],
    });
    
    if (!course) return res.status(404).json({ message: "Course not found" })

    // 1. create space
    const space = spaceRepo.create({ 
      course: { id: courseId } 
    });
    await spaceRepo.save(space);

    // 2. add creator as admin
    const member = memberRepo.create({
      space: { id: space.id },
      user: { id: customReq.user.id },
    });
    await memberRepo.save(member);

    await logActivity({
      userId: customReq.user.id,
      action: "Create Space",
      targetId: String(space.id),
      targetType: "Space",
      details: `Created space ${space.id} by ${customReq.user.first_name} ${customReq.user.last_name}`,
    });

    // Fetch complete space with relations
    const completeSpace = await spaceRepo.findOne({
      where: { id: space.id },
      relations: ["course", "members", "members.user"],
    });

    res.status(201).json({
      success: true,
      data: completeSpace,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create space" });
  }
}

export const getSpace = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space)
  const { spaceId } = req.params;

  try {
    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["messages", "messages.sender", "course", "members", "members.user"],
      order: {
        messages: { createdAt: "ASC" },
      },
    })

    if (!space) return res.status(404).json({ message: "Space not found" })

    res.json({
      success: true,
      data: space,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch space" });
  }
}

export const getSpaceByCourse = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space)
  const { courseId } = req.params;

  try {
    const spaces = await spaceRepo.find({
      where: { course: { id: courseId } },
      relations: ["messages", "messages.sender", "course", "members", "members.user"],
      order: {
        messages: { createdAt: "ASC" },
      },
    })

    res.json({
      success: true,
      data: spaces,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch spaces" });
  }
}

export const getSpacesByMember = async (req: Request, res: Response) => {
  const memberRepo = dbConnection.getRepository(SpaceMember)
  const customReq = req as CustomRequest

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
    })

    const spaces = memberships.map(m => m.space)

    res.status(200).json({
      success: true,
      message: "User spaces fetched",
      data: spaces,
    })
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch spaces" });
  }
}

export const updateSpace = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space)
  const customReq = req as CustomRequest
  const { spaceId } = req.params;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["course", "course.instructor"],
    })

    if (!space) return res.status(404).json({ message: "Space not found" })

    // Check if user is the course instructor
    if (space.course.instructor?.id !== customReq.user.id) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await spaceRepo.save(space)

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
    console.error(err);
    res.status(500).json({ message: "Failed to update space" });
  }
}

export const deleteSpace = async (req: Request, res: Response) => {
  const spaceRepo = dbConnection.getRepository(Space)
  const customReq = req as CustomRequest
  const { spaceId } = req.params;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["course", "course.instructor"],
    })

    if (!space) return res.status(404).json({ message: "Space not found" })

    // Check if user is the course instructor
    if (space.course.instructor?.id !== customReq.user.id) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const spaceIdStr = space.id;
    await spaceRepo.remove(space)

    await logActivity({
      userId: customReq.user.id,
      action: "Delete Space",
      targetId: String(spaceIdStr),
      targetType: "Space",
      details: `Deleted space ${spaceIdStr} by ${customReq.user.first_name} ${customReq.user.last_name}`,
    })

    res.json({ 
      success: true,
      message: "Space deleted" 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete space" });
  }
}

export const addMemberToSpace = async (req: Request, res: Response) => {
  const memberRepo = dbConnection.getRepository(SpaceMember)
  const spaceRepo = dbConnection.getRepository(Space)
  const userRepo = dbConnection.getRepository(User)
  const customReq = req as CustomRequest

  const { spaceId, userId } = req.body

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const space = await spaceRepo.findOne({ 
      where: { id: spaceId },
      relations: ["course", "course.instructor"],
    });
    if (!space) return res.status(404).json({ message: "Space not found" })

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: "User not found" })

    // Check if user is the course instructor (only instructor can add members)
    if (space.course.instructor?.id !== customReq.user.id) {
      return res.status(403).json({ message: "Not allowed" });
    }

    // Check if already a member
    const existing = await memberRepo.findOne({
      where: {
        space: { id: spaceId },
        user: { id: userId },
      },
    })

    if (existing) {
      return res.status(400).json({ message: "User already in space" })
    }

    const member = memberRepo.create({
      space: { id: spaceId },
      user: { id: userId },
    })

    await memberRepo.save(member)

    await logActivity({
      userId: userId,
      action: "Join Space",
      targetId: String(space.id),
      targetType: "Space",
      details: `User ${user.first_name} ${user.last_name} was added to space ${space.id}`,
    });

    res.status(201).json({ 
      success: true,
      message: "Member added to space" 
    })
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add member" });
  }
}

export const removeMemberFromSpace = async (req: Request, res: Response) => {
  const memberRepo = dbConnection.getRepository(SpaceMember)
  const customReq = req as CustomRequest
  const spaceRepo = dbConnection.getRepository(Space)

  const { spaceId, userId } = req.body

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["course", "course.instructor"],
    });
    if (!space) return res.status(404).json({ message: "Space not found" });

    // Check if user is the course instructor
    if (space.course.instructor?.id !== customReq.user.id) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const member = await memberRepo.findOne({
      where: {
        space: { id: spaceId },
        user: { id: userId },
      },
      relations: ["user"],
    })

    if (!member) {
      return res.status(404).json({ message: "Member not found in space" })
    }

    await memberRepo.remove(member)

    await logActivity({
      userId: userId,
      action: "Leave Space",
      targetId: String(spaceId),
      targetType: "Space",
      details: `User ${member.user?.first_name} ${member.user?.last_name} was removed from space ${spaceId}`,
    })

    res.status(200).json({ 
      success: true,
      message: "Member removed from space" 
    })
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to remove member" });
  }
}

export const sendMessage = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(SpaceMessage);
  const spaceRepo = dbConnection.getRepository(Space);
  const customReq = req as CustomRequest;

  const { spaceId, content } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!spaceId || !content) {
      return res.status(400).json({ message: "Missing spaceId or content" });
    }

    const space = await spaceRepo.findOne({
      where: { id: spaceId },
      relations: ["members", "members.user"],
    });

    if (!space) {
      return res.status(404).json({ message: "Space not found" });
    }

    // Check if user is a member of the space
    const isMember = space.members?.some(m => m.user?.id === customReq.user!.id);
    if (!isMember) {
      return res.status(403).json({ message: "Not a member of this space" });
    }

    const senderId = customReq.user.id;

    const message = messageRepo.create({
      space: { id: spaceId },
      sender: { id: senderId },
      content,
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

    // Fetch complete message with sender
    const completeMessage = await messageRepo.findOne({
      where: { id: message.id },
      relations: ["sender"],
    });

    res.status(201).json({
      success: true,
      message: "Message sent",
      data: completeMessage,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send message" });
  }
};