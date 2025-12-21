// @ts-nocheck
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import dotenv from "dotenv";

import dbConnection  from "../database/db";
import { User } from "../database/models/User";

dotenv.config();

const SECRET_KEY = process.env.JWT_SECRET || "default_secret_key";


interface       UserPayload    {
    id: string;
    email:string;
    first_name:string;  
    last_name?:string;
    bwenge_role?:string;    
    
}

interface CustomRequest extends Request {
  user?: UserPayload;
}

export const authenticateToken = async (req: CustomRequest, res: Response, next: NextFunction): Promise<void> => {
  let authHeader = req.header("Authorization");
  const tokenFromCookie = req.cookies?.accessToken; // Token from cookies

  // Sanitize Authorization Header
  if (authHeader?.startsWith("Bearer Bearer ")) {
    authHeader = authHeader.replace("Bearer Bearer ", "Bearer ");
  }

  // Extract Token
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : tokenFromCookie;

  if (!token) {
     res.status(401).json({ message: "Unauthorized: No token provided." });
     return;
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY) as JwtPayload;
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: decoded.id },
      relations: ['organization'], 
    });

    if (!user) {
      res.status(401).json({ message: "Users not found" });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.bwenge_role,
      isEmailVerified: user.is_verified,
      isActive: user.is_active,
      preferredLanguage: user.learning_preferences?.preferred_language || null,
      theme: user.learning_preferences?.theme || null,
      organizationId: user.primary_institution_id,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
       res.status(403).json({ message: "Unauthorized: Invalid or malformed token." });
       return;
    }
    if (error instanceof Error) {
    } else {
    }
     res.status(500).json({ message: "Internal Server Error", error: error instanceof Error ? error.message : "Unknown error" });
  }
};
