import { Router } from "express";
import { createConversation, getConversations, getUserConvoInCourse } from "../controllers/ConversationController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

router.post("/", authenticate, createConversation);
router.get("/", authenticate, getConversations);
router.get("/:courseId", authenticate, getUserConvoInCourse);

export default router;
