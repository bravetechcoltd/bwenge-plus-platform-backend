// In both systems: middlewares/systemAwareMiddleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface SystemAwareRequest extends Request {
  system?: string;
}

/**
 * Middleware to extract and validate system context from JWT
 */
export function extractSystemContext(req: SystemAwareRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.decode(token) as any;
      
      if (decoded && decoded.system) {
        req.system = decoded.system;
      }
    }
    
    next();
  } catch (error) {
    next();
  }
}

/**
 * Middleware to validate system permissions for specific operations
 */
export function validateSystemPermission(allowedSystems: string[]) {
  return (req: SystemAwareRequest, res: Response, next: NextFunction) => {
    const system = req.system;
    
    if (!system) {
      return res.status(400).json({
        success: false,
        message: "System context is required for this operation"
      });
    }
    
    if (!allowedSystems.includes(system)) {
      return res.status(403).json({
        success: false,
        message: `System ${system} is not authorized for this operation`
      });
    }
    
    next();
  };
}