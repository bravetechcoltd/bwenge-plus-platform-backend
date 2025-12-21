import { Router } from "express";
import { authenticate } from "../middlewares/authMiddleware";

import {
  getMessagesByConversation,
  sendMessage,
} from "../controllers/MessageController";

const router = Router();

// Send a message
router.post("/send", authenticate, sendMessage);
router.get("/:conversationId/convo", authenticate, getMessagesByConversation);

export default router;
