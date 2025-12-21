import { Router } from "express";
import { authenticate } from "../middlewares/authMiddleware";
import upload, { handleMulterError } from "../services/multer";

import {
  getMessagesByConversation,
  sendMessage,
  markAsRead,
  searchMessages,
  editMessage,
  deleteMessage,
  uploadAttachment,
} from "../controllers/MessageController";

import {
  addReaction,
  removeReaction,
  getReactions,
} from "../controllers/MessageReactionController";

const router = Router();

// ── Attachment upload ─────────────────────────────────────────────────────────
router.post("/upload", authenticate, upload.single("file"), handleMulterError, uploadAttachment);

// ── Send / fetch messages ─────────────────────────────────────────────────────
router.post("/send", authenticate, sendMessage);
router.get("/:conversationId/convo", authenticate, getMessagesByConversation);

// ── Enhancement #1: Read receipts ─────────────────────────────────────────────
router.patch("/:conversationId/read", authenticate, markAsRead);

// ── Enhancement #5: Search ────────────────────────────────────────────────────
router.get("/:conversationId/search", authenticate, searchMessages);

// ── Enhancement #9: Edit / Delete (soft-delete) ───────────────────────────────
router.patch("/:messageId/edit", authenticate, editMessage);
router.delete("/:messageId", authenticate, deleteMessage);

// ── Enhancement #7: Emoji Reactions (MessageReactionController) ───────────────
router.post("/:messageId/reaction", authenticate, addReaction);
router.delete("/:messageId/reaction", authenticate, removeReaction);
router.get("/:messageId/reactions", authenticate, getReactions);

export default router;
