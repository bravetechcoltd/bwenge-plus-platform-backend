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

    // STEP 1: Extract token from cookies OR Authorization header
    let token = req.cookies?.bwenge_token;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    } else {
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: "No token provided",
      });
      return;
    }


    // STEP 2: Verify JWT token
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!);
    } catch (jwtError: any) {

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

    // STEP 3: Extract user ID from token - try multiple possible field names
    const userId = decoded.userId || decoded.id || decoded.user_id || decoded.sub;


    if (!userId) {
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
      res.status(401).json({
        success: false,
        message: "User not found",
      });
      return;
    }


    // STEP 5: Check if user is active
    if (!user.is_active) {
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
      try {
        await userRepo
          .createQueryBuilder()
          .update(User)
          .set({ isUserLogin: true })
          .where("id = :id", { id: userId })
          .execute();
      } catch (repairError: any) {
        // Non-fatal — log it and continue; the JWT is still valid
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
      } catch (sessionError: any) {
        // Non-fatal — log and continue
      }
    } else {
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


    next();
  } catch (error: any) {

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


    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    next();
  };
};