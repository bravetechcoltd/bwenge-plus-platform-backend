// @ts-nocheck
import { Request, Response, NextFunction } from "express";
import dbConnection from "../database/db";
import { User, BwengeRole } from "../database/models/User";
import { Course } from "../database/models/Course";
import { CourseInstructor } from "../database/models/CourseInstructor";

export const checkInstructorRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "UNAUTHORIZED"
      });
    }

    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        error: "USER_NOT_FOUND"
      });
    }

    // Check if user has instructor privileges
    const allowedRoles = [
      BwengeRole.INSTRUCTOR,
      BwengeRole.CONTENT_CREATOR,
      BwengeRole.INSTITUTION_ADMIN,
      BwengeRole.SYSTEM_ADMIN
    ];

    if (!allowedRoles.includes(user.bwenge_role)) {
      return res.status(403).json({
        success: false,
        message: "You don't have instructor privileges",
        error: "FORBIDDEN"
      });
    }

    // Attach user to request for later use
    req.user = user;
    next();
  } catch (error: any) {
    console.error("❌ Check instructor role error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify instructor role",
      error: error.message
    });
  }
};

export const checkCourseInstructorAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { courseId } = req.params;

    if (!userId || !courseId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Course ID are required",
        error: "BAD_REQUEST"
      });
    }

    const courseRepo = dbConnection.getRepository(Course);
    const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

    // Check if user is primary instructor
    const course = await courseRepo.findOne({
      where: { id: courseId, instructor_id: userId }
    });

    if (course) {
      // User is primary instructor - full access
      (req as any).instructorRole = {
        is_primary: true,
        permissions: {
          can_grade_assignments: true,
          can_manage_enrollments: true,
          can_edit_course_content: true
        }
      };
      return next();
    }

    // Check if user is additional instructor
    const additionalInstructor = await courseInstructorRepo.findOne({
      where: {
        course_id: courseId,
        instructor_id: userId
      }
    });

    if (!additionalInstructor) {
      return res.status(403).json({
        success: false,
        message: "You are not an instructor for this course",
        error: "FORBIDDEN"
      });
    }

    // Check specific permissions based on endpoint
    const endpoint = req.path;
    
    if (endpoint.includes("/students")) {
      // For students endpoint, require can_manage_enrollments
      if (!additionalInstructor.can_manage_enrollments) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view students for this course",
          error: "FORBIDDEN"
        });
      }
    } else if (endpoint.includes("/assignments") || endpoint.includes("/grade")) {
      // For grading endpoints, require can_grade_assignments
      if (!additionalInstructor.can_grade_assignments) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to grade assignments for this course",
          error: "FORBIDDEN"
        });
      }
    }

    // Attach instructor role info to request
    (req as any).instructorRole = {
      is_primary: false,
      permissions: {
        can_grade_assignments: additionalInstructor.can_grade_assignments,
        can_manage_enrollments: additionalInstructor.can_manage_enrollments,
        can_edit_course_content: additionalInstructor.can_edit_course_content
      }
    };

    next();
  } catch (error: any) {
    console.error("❌ Check course instructor access error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify course access",
      error: error.message
    });
  }
};
