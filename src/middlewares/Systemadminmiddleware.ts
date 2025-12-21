import { Request, Response, NextFunction } from "express";
import dbConnection from "../database/db";
import { User, BwengeRole } from "../database/models/User";


export const checkSystemAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log("🔐 [checkSystemAdmin] Checking system admin access...");
    
    // Check if user is authenticated
    if (!req.user || !req.user.userId) {
      console.log("❌ [checkSystemAdmin] No authenticated user found");
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "UNAUTHORIZED"
      });
      return;
    }
    
    console.log("👤 [checkSystemAdmin] User ID:", req.user.userId);
    
    // Fetch user from database to verify role
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: req.user.userId },
      select: ["id", "email", "bwenge_role", "is_active"]
    });
    
    if (!user) {
      console.log("❌ [checkSystemAdmin] User not found in database");
      res.status(401).json({
        success: false,
        message: "User not found",
        error: "UNAUTHORIZED"
      });
      return;
    }
    
    console.log("📋 [checkSystemAdmin] User role:", user.bwenge_role);
    
    // Check if user is active
    if (!user.is_active) {
      console.log("❌ [checkSystemAdmin] User is not active");
      res.status(403).json({
        success: false,
        message: "User account is not active",
        error: "FORBIDDEN"
      });
      return;
    }
    
    // Check if user has SYSTEM_ADMIN role
    if (user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      console.log("❌ [checkSystemAdmin] User is not a system administrator");
      console.log("📋 [checkSystemAdmin] Required: SYSTEM_ADMIN, Actual:", user.bwenge_role);
      res.status(403).json({
        success: false,
        message: "System administrator access required",
        error: "FORBIDDEN"
      });
      return;
    }
    
    console.log("✅ [checkSystemAdmin] System admin access verified");
    
    // User is verified system admin, proceed
    next();
    
  } catch (error: any) {
    console.error("❌ [checkSystemAdmin] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify system admin access",
      error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
    });
  }
};