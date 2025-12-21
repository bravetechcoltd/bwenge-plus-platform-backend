import { Router } from "express";
import {
  addMemberToSpace,
  createSpace,
  deleteSpace,
  getSpace,
  getSpaceByCourse,
  removeMemberFromSpace,
  updateSpace,
  sendMessage,
  getSpacesByMember,
  getSpaceMessages,
  editSpaceMessage,
  deleteSpaceMessage,
  searchSpaceMessages,
} from "../controllers/SpaceController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// ── Literal / static paths FIRST (before /:spaceId to avoid shadow) ──────────
router.post("/", authenticate, createSpace);
router.post("/add-member", authenticate, addMemberToSpace);
router.post("/remove-member", authenticate, removeMemberFromSpace);
router.post("/send-message", authenticate, sendMessage);

// ── Enhancement #9: Edit / Delete space messages ──────────────────────────────
router.patch("/messages/:messageId/edit", authenticate, editSpaceMessage);
router.delete("/messages/:messageId", authenticate, deleteSpaceMessage);

// ── Static sub-path routes ────────────────────────────────────────────────────
router.get("/course/:courseId", authenticate, getSpaceByCourse);
router.get("/user/:id", authenticate, getSpacesByMember);

// ── Parameterised space routes ─────────────────────────────────────────────────
router.get("/:spaceId", authenticate, getSpace);
router.get("/:spaceId/messages", authenticate, getSpaceMessages);
router.get("/:spaceId/search", authenticate, searchSpaceMessages);
router.put("/:spaceId", authenticate, updateSpace);
router.delete("/:spaceId", authenticate, deleteSpace);

export default router;
