// @ts-nocheck
import { Request, Response } from "express";
import { NotificationService } from "../services/notificationService";
import { emitToUser } from "../socket/socketEmitter";

export class NotificationController {
  /**
   * GET /api/notifications
   * Fetch paginated notifications for the authenticated user
   */
  static async getNotifications(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const isReadParam = req.query.is_read;

      let isRead: boolean | undefined;
      if (isReadParam === "true") isRead = true;
      else if (isReadParam === "false") isRead = false;

      const result = await NotificationService.getUserNotifications(userId, page, limit, isRead);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error("Error fetching notifications:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch notifications",
      });
    }
  }

  /**
   * GET /api/notifications/unread-count
   * Returns the unread notification count for the authenticated user
   */
  static async getUnreadCount(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      const count = await NotificationService.getUnreadCount(userId);

      return res.json({
        success: true,
        data: { unreadCount: count },
      });
    } catch (error: any) {
      console.error("Error fetching unread count:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch unread count",
      });
    }
  }

  /**
   * PATCH /api/notifications/:id/read
   * Mark a single notification as read
   */
  static async markAsRead(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      const { id } = req.params;
      const notification = await NotificationService.markAsRead(id, userId);

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found",
        });
      }

      // ── Real-time: Sync read state + unread count across devices ──────────
      const unreadCount = await NotificationService.getUnreadCount(userId);
      emitToUser(userId, "notification-marked-read", { notificationId: id });
      emitToUser(userId, "unread-count-updated", { unreadCount });

      return res.json({
        success: true,
        data: notification,
      });
    } catch (error: any) {
      console.error("Error marking notification as read:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark notification as read",
      });
    }
  }

  /**
   * PATCH /api/notifications/read-all
   * Mark all notifications as read for the authenticated user
   */
  static async markAllAsRead(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      const count = await NotificationService.markAllAsRead(userId);

      // ── Real-time: Sync all-read state across devices ─────────────────────
      emitToUser(userId, "all-notifications-read", { markedCount: count });
      emitToUser(userId, "unread-count-updated", { unreadCount: 0 });

      return res.json({
        success: true,
        data: { markedCount: count },
        message: `${count} notifications marked as read`,
      });
    } catch (error: any) {
      console.error("Error marking all notifications as read:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark all notifications as read",
      });
    }
  }
}
