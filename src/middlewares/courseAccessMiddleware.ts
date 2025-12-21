// @ts-nocheck
import { Request, Response, NextFunction } from "express";
import dbConnection from "../database/db";
import { Course } from "../database/models/Course";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { CourseInstructor } from "../database/models/CourseInstructor";

export const checkCourseAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId } = req.params;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get course
    const courseRepo = dbConnection.getRepository(Course);
    const course = await courseRepo.findOne({
      where: { id: courseId },
      select: ["institution_id", "created_by_institution_admin_id", "instructor_id"],
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    // Check if user is system admin
    if (req.user?.bwenge_role === 'SYSTEM_ADMIN') {
      return next();
    }

    // Check if user is institution admin of course's institution
    if (course.institution_id) {
      const adminMember = await dbConnection.getRepository(InstitutionMember).findOne({
        where: {
          user_id: userId,
          institution_id: course.institution_id,
          role: 'ADMIN',
          is_active: true,
        },
      });

      if (adminMember) {
        return next();
      }
    }

    // Check if user created the course
    if (course.created_by_institution_admin_id === userId) {
      return next();
    }

    // Check if user is the course instructor
    if (course.instructor_id === userId) {
      return next();
    }

    // Check if user is an assigned instructor
    const instructorAssignment = await dbConnection.getRepository(CourseInstructor).findOne({
      where: {
        course_id: courseId,
        instructor_id: userId,
      },
    });

    if (instructorAssignment) {
      return next();
    }

    // No access
    return res.status(403).json({
      success: false,
      message: "You don't have permission to manage this course's instructors",
    });

  } catch (error: any) {
    console.error("❌ Course access check error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify course access",
      error: error.message,
    });
  }
};