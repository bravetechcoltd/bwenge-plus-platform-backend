// @ts-nocheck
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dbConnection from "../database/db";
import { UserSession, SystemType } from "../database/models/UserSession";
import { User } from "../database/models/User";
import { MoreThan } from "typeorm";

interface DecodedToken {
  userId: string;
  id?: string;
  email: string;
  account_type?: string;
  session_tokens?: {
    ongera: string;
    bwenge: string;
  };
  session_token?: string;
}

// ==================== VALIDATE SESSION MIDDLEWARE ====================
export const validateSession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log("\n🔍 [validateSession] ========== START ==========");

    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("❌ [validateSession] No token provided");
      res.status(401).json({
        success: false,
        message: "No token provided",
      });
      return;
    }

    const token = authHeader.split(" ")[1];
    console.log("✅ [validateSession] Token extracted");

    // Decode JWT
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    ) as DecodedToken;

    const userId = decoded.userId || decoded.id;
    console.log("📋 [validateSession] User ID:", userId);

    if (!userId) {
      console.log("❌ [validateSession] No user ID in token");
      res.status(401).json({
        success: false,
        message: "Invalid token: missing user ID",
      });
      return;
    }

    // Check if user exists and is active
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: userId },
      select: ['id', 'email', 'is_active', 'isUserLogin']
    });

    if (!user) {
      console.log("❌ [validateSession] User not found");
      res.status(401).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    if (!user.is_active) {
      console.log("❌ [validateSession] User account deactivated");
      res.status(403).json({
        success: false,
        message: "Account is deactivated",
      });
      return;
    }

    if (!user.isUserLogin) {
      console.log("❌ [validateSession] User not logged in (isUserLogin = false)");
      res.status(401).json({
        success: false,
        message: "User session expired. Please log in again.",
      });
      return;
    }

    console.log("✅ [validateSession] User validated");

    // Check for active Ongera session
    const sessionRepo = dbConnection.getRepository(UserSession);
    const activeSession = await sessionRepo.findOne({
      where: {
        user_id: userId,
        system: SystemType.ONGERA,
        is_active: true,
        expires_at: MoreThan(new Date())
      }
    });

    if (!activeSession) {
      console.log("❌ [validateSession] No active session found");
      
      // Update user.isUserLogin to false if no active sessions
      const remainingSessions = await sessionRepo.count({
        where: {
          user_id: userId,
          is_active: true,
          expires_at: MoreThan(new Date())
        }
      });

      if (remainingSessions === 0) {
        await userRepo.update({ id: userId }, { isUserLogin: false });
        console.log("✅ [validateSession] Updated isUserLogin to false");
      }

      res.status(401).json({
        success: false,
        message: "Session expired or invalid. Please log in again.",
      });
      return;
    }

    console.log("✅ [validateSession] Active session found");
    console.log("📋 [validateSession] Session ID:", activeSession.id);
    console.log("⏰ [validateSession] Expires at:", activeSession.expires_at);

    // Update last activity
    activeSession.last_activity = new Date();
    await sessionRepo.save(activeSession);
    console.log("✅ [validateSession] Last activity updated");

    // Attach user info to request
    req.user = {
      userId: userId,
      id: userId,
      email: decoded.email,
      account_type: decoded.account_type,
    };

    console.log("✅ [validateSession] ========== SUCCESS ==========\n");
    next();
  } catch (error: any) {
    console.error("❌ [validateSession] ========== ERROR ==========");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    if (error.name === "TokenExpiredError") {
      res.status(401).json({
        success: false,
        message: "Token expired. Please log in again.",
      });
      return;
    }

    if (error.name === "JsonWebTokenError") {
      res.status(401).json({
        success: false,
        message: "Invalid token. Please log in again.",
      });
      return;
    }

    res.status(401).json({
      success: false,
      message: "Session validation failed. Please log in again.",
    });
  }
};

// ==================== VALIDATE CROSS-SYSTEM SESSION ====================
export const validateCrossSystemSession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log("\n🔄 [validateCrossSystemSession] ========== START ==========");

    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      console.log("❌ [validateCrossSystemSession] User not authenticated");
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    console.log("📋 [validateCrossSystemSession] User ID:", userId);

    const sessionRepo = dbConnection.getRepository(UserSession);

    // Get all active sessions for user
    const sessions = await sessionRepo.find({
      where: {
        user_id: userId,
        is_active: true,
        expires_at: MoreThan(new Date())
      }
    });

    console.log("📊 [validateCrossSystemSession] Active sessions found:", sessions.length);

    const hasOngeraSession = sessions.some(s => s.system === SystemType.ONGERA);
    const hasBwengeSession = sessions.some(s => s.system === SystemType.BWENGE_PLUS);

    console.log("✅ [validateCrossSystemSession] Ongera:", hasOngeraSession ? "Active" : "Inactive");
    console.log("✅ [validateCrossSystemSession] BwengePlus:", hasBwengeSession ? "Active" : "Inactive");

    // Attach session info to request
    (req as any).sessionInfo = {
      hasOngeraSession,
      hasBwengeSession,
      sessionCount: sessions.length,
      systems: sessions.map(s => s.system)
    };

    console.log("✅ [validateCrossSystemSession] ========== SUCCESS ==========\n");
    next();
  } catch (error: any) {
    console.error("❌ [validateCrossSystemSession] ========== ERROR ==========");
    console.error("Error:", error.message);
    
    res.status(500).json({
      success: false,
      message: "Failed to validate cross-system session",
      error: error.message
    });
  }
};

// ==================== REQUIRE ACTIVE SESSION ====================
export const requireActiveSession = (system: SystemType) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      console.log(`\n🔐 [requireActiveSession] Checking ${system} session...`);

      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
        return;
      }

      const sessionRepo = dbConnection.getRepository(UserSession);
      const activeSession = await sessionRepo.findOne({
        where: {
          user_id: userId,
          system: system,
          is_active: true,
          expires_at: MoreThan(new Date())
        }
      });

      if (!activeSession) {
        console.log(`❌ [requireActiveSession] No active ${system} session`);
        res.status(403).json({
          success: false,
          message: `No active ${system} session. Please log in.`,
        });
        return;
      }

      console.log(`✅ [requireActiveSession] ${system} session active`);
      next();
    } catch (error: any) {
      console.error(`❌ [requireActiveSession] Error:`, error.message);
      res.status(500).json({
        success: false,
        message: "Failed to verify session",
        error: error.message
      });
    }
  };
};

// ==================== SESSION MONITORING MIDDLEWARE ====================
export const sessionMonitor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      next();
      return;
    }

    // Check if any sessions are about to expire (within 1 hour)
    const sessionRepo = dbConnection.getRepository(UserSession);
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

    const expiringSessions = await sessionRepo.find({
      where: {
        user_id: userId,
        is_active: true,
        expires_at: MoreThan(new Date())
      }
    });

    const expiringSoon = expiringSessions.filter(
      s => s.expires_at <= oneHourFromNow
    );

    if (expiringSoon.length > 0) {
      // Attach warning to response headers
      res.setHeader('X-Session-Expiring-Soon', 'true');
      res.setHeader('X-Sessions-Count', expiringSoon.length.toString());
      console.log(`⚠️ [sessionMonitor] ${expiringSoon.length} sessions expiring soon for user ${userId}`);
    }

    next();
  } catch (error: any) {
    console.error("❌ [sessionMonitor] Error:", error.message);
    // Don't block request on monitor error
    next();
  }
};

// ==================== CLEANUP INACTIVE SESSIONS ====================
export const cleanupInactiveSessions = async (userId: string): Promise<number> => {
  try {
    const sessionRepo = dbConnection.getRepository(UserSession);
    
    // Deactivate expired sessions
    const result = await sessionRepo
      .createQueryBuilder()
      .update(UserSession)
      .set({ is_active: false })
      .where("user_id = :userId", { userId })
      .andWhere("expires_at < :now", { now: new Date() })
      .andWhere("is_active = :active", { active: true })
      .execute();

    return result.affected || 0;
  } catch (error: any) {
    console.error("❌ [cleanupInactiveSessions] Error:", error.message);
    return 0;
  }
};