// @ts-nocheck
import { Request, Response, NextFunction } from "express";
import dbConnection from "../database/db";
import { CourseCategory } from "../database/models/CourseCategory";
import { InstitutionMember, InstitutionMemberRole } from "../database/models/InstitutionMember";
import { User, BwengeRole } from "../database/models/User";

export const checkCategoryAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id;
    const user = req.user as unknown as User;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const categoryRepo = dbConnection.getRepository(CourseCategory);
    const category = await categoryRepo.findOne({
      where: { id },
      relations: ["institution"]
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // SYSTEM_ADMIN can do anything
    if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
      return next();
    }

    // INSTITUTION_ADMIN must be admin of the category's institution
    if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const membership = await memberRepo.findOne({
        where: {
          user_id: user.id,
          institution_id: category.institution_id,
          role: InstitutionMemberRole.ADMIN,
          is_active: true
        }
      });

      if (membership) {
        return next();
      }
    }

    return res.status(403).json({
      success: false,
      message: "You don't have permission to access this category",
    });

  } catch (error: any) {
    console.error("❌ Category access check error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify category access",
      error: error.message,
    });
  }
};