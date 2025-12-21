import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/authMiddleware";
import { onlineUsers } from "../socket/socket";

const router = Router();

/**
 * GET /api/users/online-status?userIds=id1,id2,...
 * Enhancement #8: Returns online presence for a list of user IDs.
 * Reads from the in-memory Set maintained by the socket server.
 */
router.get("/online-status", authenticate, (req: Request, res: Response) => {
  try {
    const raw = req.query.userIds as string | undefined;
    if (!raw) return res.json({ success: true, onlineStatus: {} });

    const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
    const onlineStatus: Record<string, boolean> = {};
    ids.forEach((id) => {
      onlineStatus[id] = onlineUsers.has(id);
    });

    res.json({ success: true, onlineStatus });
  } catch (err) {
    console.error("online-status error:", err);
    res.status(500).json({ message: "Failed to get online status" });
  }
});

export default router;
