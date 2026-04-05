import { Router } from "express";
import { NotificationController } from "../controllers/NotificationController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// Get unread count (lightweight, called on every page load)
router.get(
  "/unread-count",
  authenticate,
  NotificationController.getUnreadCount
);

// Get paginated notifications
router.get(
  "/",
  authenticate,
  NotificationController.getNotifications
);

// Mark all notifications as read
router.patch(
  "/read-all",
  authenticate,
  NotificationController.markAllAsRead
);

// Mark a single notification as read
router.patch(
  "/:id/read",
  authenticate,
  NotificationController.markAsRead
);

export default router;
