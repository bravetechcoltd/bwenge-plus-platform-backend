// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { MessageReaction } from "../database/models/MessageReactionModel";
import { Message } from "../database/models/MessageModel";
import { Conversation } from "../database/models/ConversationModel";
import { io } from "../index";

export interface CustomRequest extends Request {
  user?: { userId: string; id: string; email: string };
}

// ── Helper: aggregate reactions from MessageReaction rows ────────────────────

const aggregateReactions = (rows: MessageReaction[]): Record<string, string[]> => {
  return rows.reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = [];
    acc[r.emoji].push(r.userId);
    return acc;
  }, {} as Record<string, string[]>);
};

// ── Helper: get conversation receiver ────────────────────────────────────────

const getReceiverId = async (conversationId: string, senderId: string): Promise<string | null> => {
  const conv = await dbConnection
    .getRepository(Conversation)
    .findOne({ where: { id: conversationId } });
  if (!conv) return null;
  return conv.participantOneId === senderId ? conv.participantTwoId : conv.participantOneId;
};

// ── Add or remove (toggle) a reaction ────────────────────────────────────────

export const addReaction = async (req: Request, res: Response) => {
  const reactionRepo = dbConnection.getRepository(MessageReaction);
  const messageRepo = dbConnection.getRepository(Message);
  const { messageId } = req.params;
  const { emoji } = req.body;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });
    if (!emoji) return res.status(400).json({ message: "emoji is required" });

    const userId = customReq.user.id;

    const message = await messageRepo.findOne({ where: { id: messageId } });
    if (!message) return res.status(404).json({ message: "Message not found" });

    // Toggle: remove if already exists, add if not
    const existing = await reactionRepo.findOne({ where: { messageId, userId, emoji } });
    if (existing) {
      await reactionRepo.remove(existing);
    } else {
      await reactionRepo.save(reactionRepo.create({ messageId, userId, emoji }));
    }

    // Aggregate all reactions for this message
    const allReactions = await reactionRepo.find({ where: { messageId } });
    const aggregated = aggregateReactions(allReactions);

    // Emit socket event to both participants
    const receiverId = await getReceiverId(message.conversationId, userId);
    const payload = { messageId, conversationId: message.conversationId, reactions: aggregated };
    if (io) {
      if (receiverId) io.to(`user-${receiverId}`).emit("reaction-updated", payload);
      io.to(`user-${userId}`).emit("reaction-updated", payload);
    }

    res.json({ success: true, reactions: aggregated });
  } catch (err) {
    console.error("addReaction error:", err);
    res.status(500).json({ message: "Failed to update reaction" });
  }
};

// ── Remove a specific reaction ────────────────────────────────────────────────

export const removeReaction = async (req: Request, res: Response) => {
  const reactionRepo = dbConnection.getRepository(MessageReaction);
  const messageRepo = dbConnection.getRepository(Message);
  const { messageId } = req.params;
  const { emoji } = req.body;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });
    if (!emoji) return res.status(400).json({ message: "emoji is required" });

    const userId = customReq.user.id;

    const reaction = await reactionRepo.findOne({ where: { messageId, userId, emoji } });
    if (!reaction) return res.status(404).json({ message: "Reaction not found" });

    await reactionRepo.remove(reaction);

    const message = await messageRepo.findOne({ where: { id: messageId } });
    if (message) {
      const allReactions = await reactionRepo.find({ where: { messageId } });
      const aggregated = aggregateReactions(allReactions);
      const receiverId = await getReceiverId(message.conversationId, userId);
      const payload = { messageId, conversationId: message.conversationId, reactions: aggregated };
      if (io) {
        if (receiverId) io.to(`user-${receiverId}`).emit("reaction-updated", payload);
        io.to(`user-${userId}`).emit("reaction-updated", payload);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("removeReaction error:", err);
    res.status(500).json({ message: "Failed to remove reaction" });
  }
};

// ── Get all reactions for a message ──────────────────────────────────────────

export const getReactions = async (req: Request, res: Response) => {
  const reactionRepo = dbConnection.getRepository(MessageReaction);
  const { messageId } = req.params;
  const customReq = req as CustomRequest;

  try {
    if (!customReq.user) return res.status(401).json({ message: "Unauthorized" });

    const rows = await reactionRepo.find({ where: { messageId } });
    res.json({ success: true, reactions: aggregateReactions(rows) });
  } catch (err) {
    console.error("getReactions error:", err);
    res.status(500).json({ message: "Failed to get reactions" });
  }
};
