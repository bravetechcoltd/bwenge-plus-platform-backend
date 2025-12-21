import { Router } from "express";
import { addMemberToSpace, createSpace, deleteSpace, getSpace, getSpaceByCourse, removeMemberFromSpace, updateSpace, sendMessage, getSpacesByMember } from "../controllers/SpaceController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

router.post("/", authenticate, createSpace);
router.get("/:spaceId", authenticate, getSpace);
router.get("/course/:courseId", authenticate, getSpaceByCourse);
router.get("/user/:id", authenticate, getSpacesByMember);
router.put("/:spaceId", authenticate, updateSpace);
router.delete("/:spaceId", authenticate, deleteSpace);
router.post("/add-member", authenticate, addMemberToSpace);
router.post("/remove-member", authenticate, removeMemberFromSpace);
router.post("/send-message", authenticate, sendMessage);


export default router;