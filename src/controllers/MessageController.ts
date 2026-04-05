// @ts-nocheck
import { Request, Response } from "express";
import { Message } from "../database/models/MessageModel";
import { logActivity } from "../middleware/ActivityLog";
import { io } from "../index";
import { Conversation, ConversationType, normalizeParticipants } from "../database/models/ConversationModel";
import dbConnection from "../database/db";
import { assertSameInstitution } from "../utils/institutionChatGuard";
import { User } from "../database/models/User";

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

// ── helpers ──────────────────────────────────────────────────────────────────

const getConvParticipants = async (conversationId: string, userId: string) => {
  const convoRepo = dbConnection.getRepository(Conversation);
  const conv = await convoRepo.findOne({ where: { id: conversationId } });
  if (!conv) return { conv: null, receiverId: null };
  const receiverId = conv.participantOneId === userId ? conv.participantTwoId : conv.participantOneId;
  return { conv, receiverId };
};

// ── Enhancement #6: Upload attachment ────────────────────────────────────────

export const uploadAttachment = async (req: Request, res: Response) => {
  const customReq = req as CustomRequest;
  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const relativePath = req.file.path.replace(/\\/g, "/");
    const attachmentUrl = `${baseUrl}/${relativePath}`;

    res.json({ success: true, attachmentUrl, filename: req.file.originalname, mimetype: req.file.mimetype });
  } catch (err) {
    res.status(500).json({ message: "Upload failed" });
  }
};

// ── Send a message ────────────────────────────────────────────────────────────

export const sendMessage = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(Message);
  const convoRepo = dbConnection.getRepository(Conversation);
  const customReq = req as CustomRequest;

  const { conversationId, content, attachmentUrl } = req.body;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });

    if (!conversationId || (!content && !attachmentUrl)) {
      return res.status(400).json({ message: "Missing conversationId or content/attachment" });
    }

    const conversation = await convoRepo.findOne({
      where: { id: conversationId },
      relations: ["participantOne", "participantTwo", "course", "institution"],
    });

    if (!conversation) return res.status(404).json({ message: "Conversation not found" });

    const senderId = customReq.user.id;

    if (!conversation.isParticipant(senderId)) {
      return res.status(403).json({ message: "Not part of this conversation" });
    }

    if (conversation.conversationType === ConversationType.INSTITUTION_DIRECT) {
      const otherUser = conversation.getOtherUser(senderId);
      if (otherUser) {
        const { hasSharedInstitution } = await assertSameInstitution(senderId, otherUser.id);
        if (!hasSharedInstitution) {
          return res.status(403).json({ message: "Both participants must be members of the same institution" });
        }
      }
    }

    const userRepo = dbConnection.getRepository(User);
    const sender = await userRepo.findOne({
      where: { id: senderId },
      select: ["id", "first_name", "last_name", "profile_picture_url", "email"],
    });

    const message = messageRepo.create({
      conversation: { id: conversationId },
      sender: { id: senderId },
      content: content || "",
      attachmentUrl: attachmentUrl || null,
      status: "sent",
    });

    await messageRepo.save(message);

    const receiverId =
      conversation.participantOneId === senderId ? conversation.participantTwoId : conversation.participantOneId;

    const messageWithSender = {
      id: message.id,
      conversationId: conversation.id,
      messageId: message.id,
      senderId,
      content: content || "",
      attachmentUrl: attachmentUrl || null,
      courseId: conversation.courseId || null,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isRead: false,
      readAt: null,
      status: "sent",
      isEdited: false,
      reactions: {},
      sender: sender
        ? {
            id: sender.id,
            first_name: sender.first_name,
            last_name: sender.last_name,
            profile_picture_url: sender.profile_picture_url,
            email: sender.email,
          }
        : null,
    };

    if (io) {
      io.to(`user-${receiverId}`).emit("new-message", messageWithSender);
      io.to(`user-${senderId}`).emit("message-sent", messageWithSender);

      // ── Real-time: Update conversation list for both participants ─────────
      const conversationUpdate = {
        conversationId: conversation.id,
        lastMessage: {
          content: content || "",
          attachmentUrl: attachmentUrl || null,
          senderId,
          createdAt: message.createdAt,
        },
        updatedAt: message.createdAt,
      };
      io.to(`user-${receiverId}`).emit("conversation-updated", conversationUpdate);
      io.to(`user-${senderId}`).emit("conversation-updated", conversationUpdate);
    }

    await logActivity({
      userId: senderId,
      action: "Sent a message",
      targetId: String(conversation.id),
      targetType: "Conversation",
      details: "Message sent",
    });

    const completeMessage = await messageRepo.findOne({ where: { id: message.id }, relations: ["sender"] });

    res.status(201).json({ success: true, message: "Message sent", data: completeMessage });
  } catch (err) {
    res.status(500).json({ message: "Failed to send message" });
  }
};

// ── Enhancement #3: Get messages with cursor pagination (filter soft-deleted) ─

export const getMessagesByConversation = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(Message);
  const { conversationId } = req.params;
  const { limit = 50, before } = req.query;

  try {
    const qb = messageRepo
      .createQueryBuilder("msg")
      .leftJoinAndSelect("msg.sender", "sender")
      .where("msg.conversationId = :conversationId", { conversationId })
      .andWhere("msg.deletedAt IS NULL")  // exclude soft-deleted
      .orderBy("msg.createdAt", "DESC")
      .take(Number(limit));

    if (before) {
      qb.andWhere("msg.createdAt < :before", { before: new Date(before as string) });
    }

    const messages = await qb.getMany();
    const ordered = messages.reverse();

    res.status(200).json({
      success: true,
      message: "Messages fetched",
      data: ordered,
      pagination: {
        hasMore: messages.length === Number(limit),
        nextCursor: messages.length > 0 ? ordered[0].createdAt : null,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch messages" });
  }
};

// ── Enhancement #1: Mark messages as read ────────────────────────────────────

export const markAsRead = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(Message);
  const { conversationId } = req.params;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });

    const userId = customReq.user.id;

    // Find unread messages not sent by the current user
    const unreadMessages = await messageRepo.find({
      where: { conversationId, isRead: false },
      select: ["id", "senderId"],
    });

    const toMark = unreadMessages.filter((m) => m.senderId !== userId);
    if (toMark.length > 0) {
      await messageRepo
        .createQueryBuilder()
        .update(Message)
        .set({ isRead: true, status: "read", readAt: new Date() })
        .whereInIds(toMark.map((m) => m.id))
        .execute();

      // Notify all unique senders that their messages were read
      const senderIds = [...new Set(toMark.map((m) => m.senderId))];
      senderIds.forEach((sid) => {
        if (io) io.to(`user-${sid}`).emit("message-read", { conversationId, readBy: userId });
      });

      // Update unread count for current user
      if (io) io.to(`user-${userId}`).emit("unread-count-updated", { conversationId, unreadCount: 0 });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to mark messages as read" });
  }
};

// ── Enhancement #5: Search messages ──────────────────────────────────────────

export const searchMessages = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(Message);
  const { conversationId } = req.params;
  const { q } = req.query;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });
    if (!q || !(q as string).trim()) return res.status(400).json({ message: "Query required" });

    const messages = await messageRepo
      .createQueryBuilder("msg")
      .leftJoinAndSelect("msg.sender", "sender")
      .where("msg.conversationId = :conversationId", { conversationId })
      .andWhere("msg.deletedAt IS NULL")
      .andWhere("LOWER(msg.content) LIKE LOWER(:q)", { q: `%${(q as string).trim()}%` })
      .orderBy("msg.createdAt", "ASC")
      .getMany();

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ message: "Failed to search messages" });
  }
};

// ── Enhancement #9: Edit message ─────────────────────────────────────────────

export const editMessage = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(Message);
  const { messageId } = req.params;
  const { content } = req.body;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });
    if (!content?.trim()) return res.status(400).json({ message: "Content required" });

    const message = await messageRepo.findOne({ where: { id: messageId } });
    if (!message) return res.status(404).json({ message: "Message not found" });
    if (message.senderId !== customReq.user.id) return res.status(403).json({ message: "Not your message" });

    const { receiverId } = await getConvParticipants(message.conversationId, customReq.user.id);

    message.content = content.trim();
    message.isEdited = true;
    await messageRepo.save(message);

    const payload = { messageId, conversationId: message.conversationId, content: message.content, isEdited: true };
    if (io) {
      if (receiverId) io.to(`user-${receiverId}`).emit("message-edited", payload);
      io.to(`user-${customReq.user.id}`).emit("message-edited", payload);
    }

    res.json({ success: true, data: message });
  } catch (err) {
    res.status(500).json({ message: "Failed to edit message" });
  }
};

// ── Enhancement #9: Delete message (soft-delete) ─────────────────────────────

export const deleteMessage = async (req: Request, res: Response) => {
  const messageRepo = dbConnection.getRepository(Message);
  const { messageId } = req.params;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });

    const message = await messageRepo.findOne({ where: { id: messageId } });
    if (!message) return res.status(404).json({ message: "Message not found" });
    if (message.senderId !== customReq.user.id) return res.status(403).json({ message: "Not your message" });

    const { receiverId } = await getConvParticipants(message.conversationId, customReq.user.id);
    const conversationId = message.conversationId;

    // Soft-delete: stamp deletedAt instead of hard remove
    message.deletedAt = new Date();
    await messageRepo.save(message);

    const payload = { messageId, conversationId };
    if (io) {
      if (receiverId) io.to(`user-${receiverId}`).emit("message-deleted", payload);
      io.to(`user-${customReq.user.id}`).emit("message-deleted", payload);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete message" });
  }
};

// Emoji reactions are handled by MessageReactionController.ts
