import cron from "node-cron";
import dbConnection from "../database/db";
import { UserSession } from "../database/models/UserSession";
import { User } from "../database/models/User";
import { LessThan } from "typeorm";
import { logger } from "../helpers/logger";

export class SessionCleanupService {
  static start() {
    // Run every hour
    cron.schedule("0 * * * *", async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error: any) {
        logger.error("Session cleanup error:", error);
      }
    });

    logger.info("✅ Session cleanup service started (runs every hour)");
  }

  static async cleanupExpiredSessions() {
    try {
      logger.info("🧹 [SESSION CLEANUP] Starting...");

      const sessionRepo = dbConnection.getRepository(UserSession);
      const userRepo = dbConnection.getRepository(User);

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Find expired sessions
      const expiredSessions = await sessionRepo.find({
        where: [
          { expires_at: LessThan(now) },
          { last_activity: LessThan(sevenDaysAgo) }
        ]
      });

      if (expiredSessions.length === 0) {
        logger.info("✅ [SESSION CLEANUP] No expired sessions found");
        return;
      }

      logger.info(`🗑️ [SESSION CLEANUP] Found ${expiredSessions.length} expired sessions`);

      // Group sessions by user
      const userSessionMap = new Map<string, UserSession[]>();
      expiredSessions.forEach(session => {
        if (!userSessionMap.has(session.user_id)) {
          userSessionMap.set(session.user_id, []);
        }
        userSessionMap.get(session.user_id)!.push(session);
      });

      // Delete expired sessions
      await sessionRepo.remove(expiredSessions);
      logger.info(`✅ [SESSION CLEANUP] Deleted ${expiredSessions.length} expired sessions`);

      // Check each affected user
      for (const [userId, deletedSessions] of userSessionMap) {
        // Check if user has any remaining active sessions
        const remainingSessions = await sessionRepo.count({
          where: {
            user_id: userId,
            is_active: true,
            expires_at: LessThan(now)
          }
        });

        // If no active sessions remain, set isUserLogin to false
        if (remainingSessions === 0) {
          await userRepo.update(
            { id: userId },
            { isUserLogin: false }
          );
          logger.info(`✅ [SESSION CLEANUP] User ${userId} - isUserLogin set to false (no active sessions)`);
        }
      }

      logger.info("✅ [SESSION CLEANUP] Cleanup complete");
    } catch (error: any) {
      logger.error("❌ [SESSION CLEANUP] Error:", error);
      throw error;
    }
  }

  // Manual cleanup method (can be called for testing)
  static async cleanupNow() {
    logger.info("🧹 [SESSION CLEANUP] Manual cleanup triggered");
    await this.cleanupExpiredSessions();
  }
}