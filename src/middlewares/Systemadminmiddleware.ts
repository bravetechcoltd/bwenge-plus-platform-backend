import { Request, Response, NextFunction } from "express";
import dbConnection from "../database/db";
import { User, BwengeRole } from "../database/models/User";


export const checkSystemAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    
    // Check if user is authenticated
    if (!req.user || !req.user.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "UNAUTHORIZED"
      });
      return;
    }
    
    
    // Fetch user from database to verify role
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: req.user.userId },
      select: ["id", "email", "bwenge_role", "is_active"]
    });
    
    if (!user) {
      res.status(401).json({
        success: false,
        message: "User not found",
        error: "UNAUTHORIZED"
      });
      return;
    }
    
    
    // Check if user is active
    if (!user.is_active) {
      res.status(403).json({
        success: false,
        message: "User account is not active",
        error: "FORBIDDEN"
      });
      return;
    }
    
    // Check if user has SYSTEM_ADMIN role
    if (user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      res.status(403).json({
        success: false,
        message: "System administrator access required",
        error: "FORBIDDEN"
      });
      return;
    }
    
    
    // User is verified system admin, proceed
    next();
    
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to verify system admin access",
      error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
    });
  }
};