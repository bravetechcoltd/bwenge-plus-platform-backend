// @ts-nocheck

import { Request, Response } from "express";
import { Message } from "../database/models/MessageModel";
import { logActivity } from "../middleware/ActivityLog";
import { io } from "..";
import { Conversation } from "../database/models/ConversationModel";
import dbConnection from "../database/db";

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

// Send a message
export const sendMessage = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(Message);
  const convoRepo = dbConnection.getRepository(Conversation);
  const customReq = req as CustomRequest;

  const { conversationId, content } = req.body;

  try {
    if (!customReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!conversationId || !content) {
      return res.status(400).json({ message: "Missing conversationId or content" });
    }

    const conversation = await convoRepo.findOne({
      where: { id: conversationId },
      relations: ["student", "instructor"],
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const senderId = customReq.user.id;

    // Ownership check
    if (
      conversation.studentId !== senderId &&
      conversation.instructorId !== senderId
    ) {
      return res.status(403).json({ message: "Not part of this conversation" });
    }

    // Create message using relations
    const message = messageRepo.create({
      conversation: { id: conversationId },
      sender: { id: senderId },
      content,
      status: "sent",
    });

    await messageRepo.save(message);

    // Emit to the OTHER participant
    const receiverId =
      senderId === conversation.studentId
        ? conversation.instructorId
        : conversation.studentId;

    if (io) {
      console.log('📡 Emitting message to:', `user-${receiverId}`);
      io.to(`user-${receiverId}`).emit("new-message", {
        id: message.id,
        conversationId: conversation.id,
        messageId: message.id,
        senderId,
        content,
        courseId: conversation.courseId || null,
        createdAt: message.createdAt,
      });
    }

    await logActivity({
      userId: senderId,
      action: "Sent a message",
      targetId: String(conversation.id),
      targetType: "Conversation",
      details: "Message sent",
    });

    // Fetch the complete message with sender relation
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

export const getMessagesByConversation = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(Message);
  const { conversationId } = req.params;

  try {
    const messages = await messageRepo.find({
      where: { conversation: { id: conversationId } },
      relations: ["sender"],
      order: { createdAt: "ASC" },
    });

    res.status(200).json({
      success: true,
      message: "Messages fetched",
      data: messages,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
};