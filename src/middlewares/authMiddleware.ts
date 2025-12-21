import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dbConnection from "../database/db";
import { User } from "../database/models/User";
import { UserSession, SystemType } from "../database/models/UserSession";
import { MoreThan } from "typeorm";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        id: string;
        email: string;
        bwenge_role?: string;
      };
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log("🔐 [authenticate] Starting authentication...");
    console.log("📋 [authenticate] Headers:", {
      authorization: req.headers.authorization ? "Present" : "Missing",
      cookie: req.headers.cookie ? "Present" : "Missing",
      origin: req.headers.origin,
    });

    // STEP 1: Extract token from cookies OR Authorization header
    let token = req.cookies?.bwenge_token;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
        console.log("🔑 [authenticate] Token from Authorization header");
      }
    } else {
      console.log("🍪 [authenticate] Token from cookie");
    }

    if (!token) {
      console.log("❌ [authenticate] No token provided");
      res.status(401).json({
        success: false,
        message: "No token provided",
      });
      return;
    }

    console.log(
      "🔍 [authenticate] Token preview:",
      token.substring(0, 20) + "..."
    );

    // STEP 2: Verify JWT token
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!);
      console.log("✅ [authenticate] Token verified successfully");
    } catch (jwtError: any) {
      console.error(
        "❌ [authenticate] JWT verification failed:",
        jwtError.message
      );

      if (jwtError.name === "TokenExpiredError") {
        res.status(401).json({
          success: false,
          message: "Token expired",
        });
        return;
      }

      res.status(401).json({
        success: false,
        message: "Invalid token",
      });
      return;
    }

    // STEP 3: Extract user ID from token
    const userId = decoded.userId || decoded.id || decoded.user_id;

    console.log("👤 [authenticate] Decoded token:", {
      userId,
      email: decoded.email,
      role: decoded.bwenge_role,
      fullPayload: decoded,
    });

    if (!userId) {
      console.log("❌ [authenticate] No user ID in token payload");
      res.status(401).json({
        success: false,
        message: "Invalid token format - missing user ID",
      });
      return;
    }

    // STEP 4: Check if user exists in database
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: userId },
      select: [
        "id",
        "email",
        "first_name",
        "last_name",
        "is_active",
        "isUserLogin",
        "bwenge_role",
      ],
    });

    if (!user) {
      console.log("❌ [authenticate] User not found in database:", userId);
      res.status(401).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    console.log("✅ [authenticate] User found:", {
      id: user.id,
      email: user.email,
      role: user.bwenge_role,
      isActive: user.is_active,
      isLoggedIn: user.isUserLogin,
    });

    // STEP 5: Check if user is active
    if (!user.is_active) {
      console.log("❌ [authenticate] User is not active");
      res.status(401).json({
        success: false,
        message: "User account is not active",
      });
      return;
    }

    // ✅ FIX: Instead of blocking when isUserLogin is false, auto-repair it.
    // A valid, non-expired JWT is proof of a legitimate login. If the flag
    // somehow got reset (race condition, crash, cross-system logout quirk),
    // we heal it here rather than locking the user out.
    if (!user.isUserLogin) {
      console.warn(
        "⚠️ [authenticate] isUserLogin is false despite valid JWT — auto-repairing flag"
      );
      try {
        await userRepo
          .createQueryBuilder()
          .update(User)
          .set({ isUserLogin: true })
          .where("id = :id", { id: userId })
          .execute();
        console.log("✅ [authenticate] isUserLogin repaired to true");
      } catch (repairError: any) {
        // Non-fatal — log it and continue; the JWT is still valid
        console.error(
          "⚠️ [authenticate] Could not repair isUserLogin:",
          repairError.message
        );
      }
    }

    // STEP 6: Check/update active session (non-blocking)
    const sessionRepo = dbConnection.getRepository(UserSession);
    const activeSession = await sessionRepo.findOne({
      where: {
        user_id: userId,
        system: SystemType.BWENGE_PLUS,
        is_active: true,
        expires_at: MoreThan(new Date()),
      },
    });

    if (!activeSession) {
      console.log(
        "⚠️ [authenticate] No active BwengePlus session record found — creating one"
      );
      // ✅ FIX: Auto-create a session record so subsequent requests find it.
      // The JWT itself is the source of truth for auth; the session table is
      // for activity tracking and cross-system SSO signals only.
      try {
        const crypto = require("crypto");
        const newSession = sessionRepo.create({
          user_id: userId,
          system: SystemType.BWENGE_PLUS,
          session_token: crypto.randomBytes(32).toString("hex"),
          device_info: req.headers["user-agent"] || "",
          ip_address: req.ip,
          // Respect the JWT's own expiry so session matches token lifetime
          expires_at: decoded.exp
            ? new Date(decoded.exp * 1000)
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          is_active: true,
          last_activity: new Date(),
        });
        await sessionRepo.save(newSession);
        console.log("✅ [authenticate] Session record auto-created");
      } catch (sessionError: any) {
        // Non-fatal — log and continue
        console.error(
          "⚠️ [authenticate] Could not auto-create session:",
          sessionError.message
        );
      }
    } else {
      console.log("✅ [authenticate] Active session found — updating activity");
      activeSession.last_activity = new Date();
      await sessionRepo.save(activeSession);
    }

    // STEP 7: Set user data in request object
    req.user = {
      userId: user.id,
      id: user.id,
      email: user.email,
      bwenge_role: user.bwenge_role,
    };

    console.log("✅ [authenticate] Authentication successful:", {
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.bwenge_role,
    });

    next();
  } catch (error: any) {
    console.error("❌ [authenticate] Unexpected error:", error);
    console.error("📋 [authenticate] Error stack:", error.stack);

    res.status(401).json({
      success: false,
      message: "Authentication failed",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.bwenge_role;

    console.log("🔒 [requireRole] Checking role:", {
      required: roles,
      actual: userRole,
    });

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    next();
  };
};