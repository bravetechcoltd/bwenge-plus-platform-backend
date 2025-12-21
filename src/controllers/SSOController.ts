import { Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import dbConnection from "../database/db";
import { User } from "../database/models/User";
import { UserSession, SystemType } from "../database/models/UserSession";
import { SSOToken } from "../database/models/SSOToken";
import { MoreThan } from "typeorm";

export class SSOController {
  // ==================== GENERATE SSO TOKEN ====================
  static async generateToken(req: Request, res: Response) {
    try {
      console.log("\n🔐 ========== SSO: GENERATE TOKEN ==========");
      const userId = req.user?.userId || req.user?.id;
      const { target_system } = req.body;

      console.log("📋 User ID:", userId);
      console.log("📋 Target System:", target_system);

      // Validate authentication
      if (!userId) {
        console.log("❌ User not authenticated");
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      // Validate target system
      if (!target_system || target_system !== "BWENGE_PLUS") {
        console.log("❌ Invalid target system:", target_system);
        return res.status(400).json({
          success: false,
          message: "Invalid target system. Must be 'BWENGE_PLUS'"
        });
      }

      // Get user
      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId } });

      if (!user) {
        console.log("❌ User not found:", userId);
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      if (!user.isUserLogin) {
        console.log("❌ User not logged in (isUserLogin = false)");
        return res.status(403).json({
          success: false,
          message: "User not logged in to any system"
        });
      }

      console.log("✅ User validated:", user.email);

      // Check for existing active session in target system
      const sessionRepo = dbConnection.getRepository(UserSession);
      const activeSession = await sessionRepo.findOne({
        where: {
          user_id: userId,
          system: SystemType.BWENGE_PLUS,
          is_active: true,
          expires_at: MoreThan(new Date())
        }
      });

      if (activeSession) {
        console.log("✅ Found existing BwengePlus session");
      }

      // Generate SSO token
      const ssoToken = crypto.randomBytes(48).toString('hex');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      const tokenRepo = dbConnection.getRepository(SSOToken);
      const tokenRecord = tokenRepo.create({
        user_id: userId,
        token: ssoToken,
        target_system: target_system,
        expires_at: expiresAt,
        consumed: false
      });

      await tokenRepo.save(tokenRecord);

      console.log("✅ SSO Token generated:", ssoToken.substring(0, 16) + "...");
      console.log("⏰ Expires at:", expiresAt.toISOString());
      console.log("🔗 Redirect URL:", `${process.env.BWENGE_PLUS_URL}/sso/consume?token=${ssoToken}`);

      res.json({
        success: true,
        message: "SSO token generated successfully",
        data: {
          sso_token: ssoToken,
          expires_in: 300, // seconds
          expires_at: expiresAt,
          redirect_url: `${process.env.BWENGE_PLUS_URL}/sso/consume?token=${ssoToken}`,
          has_existing_session: !!activeSession,
          target_system: target_system
        }
      });
    } catch (error: any) {
      console.error("❌ ========== SSO: GENERATE TOKEN ERROR ==========");
      console.error("Error:", error.message);
      console.error("Stack:", error.stack);
      
      res.status(500).json({
        success: false,
        message: "Failed to generate SSO token",
        error: error.message
      });
    }
  }

  // ==================== CONSUME SSO TOKEN ====================
  static async consumeToken(req: Request, res: Response) {
    try {
      console.log("\n🔓 ========== SSO: CONSUME TOKEN ==========");
      const { sso_token } = req.body;

      console.log("📋 Token received:", sso_token ? sso_token.substring(0, 16) + "..." : "NONE");

      if (!sso_token) {
        console.log("❌ No SSO token provided");
        return res.status(400).json({
          success: false,
          message: "SSO token is required"
        });
      }

      // Find token
      const tokenRepo = dbConnection.getRepository(SSOToken);
      const tokenRecord = await tokenRepo.findOne({
        where: {
          token: sso_token,
          consumed: false,
          expires_at: MoreThan(new Date())
        }
      });

      if (!tokenRecord) {
        console.log("❌ Token not found or expired");
        return res.status(401).json({
          success: false,
          message: "Invalid or expired SSO token"
        });
      }

      console.log("✅ Token found - User ID:", tokenRecord.user_id);
      console.log("📋 Target System:", tokenRecord.target_system);

      // Get user with full details
      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: tokenRecord.user_id },
        relations: ["profile"]
      });

      if (!user) {
        console.log("❌ User not found:", tokenRecord.user_id);
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      if (!user.is_active) {
        console.log("❌ User account is deactivated");
        return res.status(403).json({
          success: false,
          message: "User account is deactivated"
        });
      }

      if (!user.isUserLogin) {
        console.log("❌ User session invalid (isUserLogin = false)");
        return res.status(403).json({
          success: false,
          message: "User session invalid"
        });
      }

      console.log("✅ User validated:", user.email);

      // Mark token as consumed
      tokenRecord.consumed = true;
      tokenRecord.consumed_at = new Date();
      await tokenRepo.save(tokenRecord);
      console.log("✅ Token marked as consumed");

      // Find or create Ongera session
      const sessionRepo = dbConnection.getRepository(UserSession);
      let session = await sessionRepo.findOne({
        where: {
          user_id: user.id,
          system: SystemType.ONGERA,
          is_active: true,
          expires_at: MoreThan(new Date())
        }
      });

      if (!session) {
        console.log("📝 Creating new Ongera session");
        const sessionToken = crypto.randomBytes(32).toString('hex');
        session = sessionRepo.create({
          user_id: user.id,
          system: SystemType.ONGERA,
          session_token: sessionToken,
          device_info: req.headers['user-agent'] || '',
          ip_address: req.ip,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          is_active: true
        });
        await sessionRepo.save(session);
        console.log("✅ New session created:", sessionToken.substring(0, 10) + "...");
      } else {
        console.log("✅ Using existing Ongera session");
      }

      // Generate JWT for the requesting system
      const jwtToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          account_type: user.account_type,
          session_token: session.session_token
        },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );

      console.log("✅ JWT generated for user");

      // Prepare user data response
      const userData = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        phone_number: user.phone_number,
        profile_picture_url: user.profile_picture_url,
        bio: user.bio,
        account_type: user.account_type,
        is_verified: user.is_verified,
        country: user.country,
        city: user.city,
        profile: user.profile
      };

      console.log("✅ ========== SSO: TOKEN CONSUMED SUCCESSFULLY ==========\n");

      res.json({
        success: true,
        message: "SSO authentication successful",
        data: {
          user: userData,
          token: jwtToken
        }
      });
    } catch (error: any) {
      console.error("❌ ========== SSO: CONSUME TOKEN ERROR ==========");
      console.error("Error:", error.message);
      console.error("Stack:", error.stack);
      
      res.status(500).json({
        success: false,
        message: "Failed to consume SSO token",
        error: error.message
      });
    }
  }

  // ==================== VALIDATE SESSION ====================
  static async validateSession(req: Request, res: Response) {
    try {
      console.log("\n✅ ========== SSO: VALIDATE SESSION ==========");
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        console.log("❌ User not authenticated");
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      console.log("📋 Validating sessions for user:", userId);

      const sessionRepo = dbConnection.getRepository(UserSession);
      
      // Check Ongera session
      const ongeraSession = await sessionRepo.findOne({
        where: {
          user_id: userId,
          system: SystemType.ONGERA,
          is_active: true,
          expires_at: MoreThan(new Date())
        }
      });

      // Check BwengePlus session
      const bwengeSession = await sessionRepo.findOne({
        where: {
          user_id: userId,
          system: SystemType.BWENGE_PLUS,
          is_active: true,
          expires_at: MoreThan(new Date())
        }
      });

      const hasOngeraSession = !!ongeraSession;
      const hasBwengeSession = !!bwengeSession;

      console.log("📊 Session Status:");
      console.log("  - Ongera:", hasOngeraSession ? "✅ Active" : "❌ Inactive");
      console.log("  - BwengePlus:", hasBwengeSession ? "✅ Active" : "❌ Inactive");

      const systemsWithSessions = [
        hasOngeraSession && "ONGERA",
        hasBwengeSession && "BWENGE_PLUS"
      ].filter(Boolean);

      console.log("✅ Session validation complete\n");

      res.json({
        success: true,
        data: {
          has_ongera_session: hasOngeraSession,
          has_bwenge_session: hasBwengeSession,
          systems_with_sessions: systemsWithSessions,
          total_active_sessions: systemsWithSessions.length
        }
      });
    } catch (error: any) {
      console.error("❌ ========== SSO: VALIDATE SESSION ERROR ==========");
      console.error("Error:", error.message);
      
      res.status(500).json({
        success: false,
        message: "Failed to validate session",
        error: error.message
      });
    }
  }

  // ==================== VALIDATE TOKEN (For BwengePlus) ====================
  static async validateToken(req: Request, res: Response) {
    try {
      console.log("\n🔍 ========== SSO: VALIDATE TOKEN ==========");
      const { sso_token } = req.body;

      console.log("📋 Validating token:", sso_token ? sso_token.substring(0, 16) + "..." : "NONE");

      if (!sso_token) {
        return res.status(400).json({
          success: false,
          message: "SSO token is required"
        });
      }

      const tokenRepo = dbConnection.getRepository(SSOToken);
      const tokenRecord = await tokenRepo.findOne({
        where: {
          token: sso_token,
          consumed: false,
          expires_at: MoreThan(new Date())
        }
      });

      if (!tokenRecord) {
        console.log("❌ Token invalid or expired");
        return res.status(401).json({
          success: false,
          message: "Invalid or expired SSO token"
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({
        where: { id: tokenRecord.user_id },
        relations: ["profile"],
        select: [
          'id', 'email', 'first_name', 'last_name', 'username',
          'account_type', 'profile_picture_url', 'is_verified', 'is_active'
        ]
      });

      if (!user) {
        console.log("❌ User not found");
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      console.log("✅ Token validated for user:", user.email);

      res.json({
        success: true,
        message: "Token is valid",
        data: {
          user_id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          account_type: user.account_type,
          target_system: tokenRecord.target_system,
          expires_at: tokenRecord.expires_at
        }
      });
    } catch (error: any) {
      console.error("❌ ========== SSO: VALIDATE TOKEN ERROR ==========");
      console.error("Error:", error.message);
      
      res.status(500).json({
        success: false,
        message: "Failed to validate token",
        error: error.message
      });
    }
  }

  // ==================== TERMINATE CROSS-SYSTEM SESSION ====================
  static async terminateCrossSystemSession(req: Request, res: Response) {
    try {
      console.log("\n🔴 ========== SSO: TERMINATE CROSS-SYSTEM SESSION ==========");
      const { user_id, system } = req.body;

      console.log("📋 User ID:", user_id);
      console.log("📋 System:", system);

      if (!user_id || !system) {
        return res.status(400).json({
          success: false,
          message: "user_id and system are required"
        });
      }

      const sessionRepo = dbConnection.getRepository(UserSession);
      
      // Deactivate session for specific system
      const result = await sessionRepo.update(
        {
          user_id: user_id,
          system: system as SystemType,
          is_active: true
        },
        {
          is_active: false
        }
      );

      console.log("✅ Sessions terminated:", result.affected || 0);

      // Check if user has any remaining active sessions
      const remainingSessions = await sessionRepo.count({
        where: {
          user_id: user_id,
          is_active: true,
          expires_at: MoreThan(new Date())
        }
      });

      console.log("📊 Remaining active sessions:", remainingSessions);

      // If no active sessions, update user.isUserLogin
      if (remainingSessions === 0) {
        const userRepo = dbConnection.getRepository(User);
        await userRepo.update(
          { id: user_id },
          { isUserLogin: false }
        );
        console.log("✅ User.isUserLogin set to false (no active sessions)");
      }

      res.json({
        success: true,
        message: "Session terminated successfully",
        data: {
          sessions_terminated: result.affected || 0,
          remaining_sessions: remainingSessions
        }
      });
    } catch (error: any) {
      console.error("❌ ========== SSO: TERMINATE SESSION ERROR ==========");
      console.error("Error:", error.message);
      
      res.status(500).json({
        success: false,
        message: "Failed to terminate session",
        error: error.message
      });
    }
  }

  // ==================== GET USER SESSIONS ====================
  static async getUserSessions(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated"
        });
      }

      const sessionRepo = dbConnection.getRepository(UserSession);
      const sessions = await sessionRepo.find({
        where: {
          user_id: userId,
          is_active: true,
          expires_at: MoreThan(new Date())
        },
        order: {
          last_activity: 'DESC'
        }
      });

      const sessionsData = sessions.map(session => ({
        id: session.id,
        system: session.system,
        device_info: session.device_info,
        ip_address: session.ip_address,
        created_at: session.created_at,
        last_activity: session.last_activity,
        expires_at: session.expires_at
      }));

      res.json({
        success: true,
        data: {
          sessions: sessionsData,
          total_sessions: sessions.length
        }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to get user sessions",
        error: error.message
      });
    }
  }

  // ==================== CLEANUP EXPIRED TOKENS ====================
  static async cleanupExpiredTokens(req: Request, res: Response) {
    try {
      console.log("\n🧹 ========== SSO: CLEANUP EXPIRED TOKENS ==========");

      const tokenRepo = dbConnection.getRepository(SSOToken);
      
      // Delete expired or consumed tokens older than 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      const result = await tokenRepo
        .createQueryBuilder()
        .delete()
        .where("expires_at < :now", { now: new Date() })
        .orWhere("(consumed = :consumed AND consumed_at < :oneHourAgo)", { 
          consumed: true, 
          oneHourAgo 
        })
        .execute();

      console.log("✅ Deleted", result.affected || 0, "expired/old tokens");

      res.json({
        success: true,
        message: "Cleanup completed",
        data: {
          tokens_deleted: result.affected || 0
        }
      });
    } catch (error: any) {
      console.error("❌ Cleanup error:", error.message);
      
      res.status(500).json({
        success: false,
        message: "Failed to cleanup tokens",
        error: error.message
      });
    }
  }
}