// @ts-nocheck
import { Request, Response, NextFunction } from "express";
import dbConnection from "../database/db";
import { User, BwengeRole } from "../database/models/User";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { Course, CourseType } from "../database/models/Course";
import { Enrollment } from "../database/models/Enrollment";
import { Institution } from "../database/models/Institution";

export class AccessControlMiddleware {
  // ==================== CHECK SYSTEM ADMIN ====================
  static checkSystemAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId } });

      if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({
          success: false,
          message: "Only system administrators can access this",
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Access control check failed",
        error: error.message,
      });
    }
  };

    static async toggleInstitutionStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({ where: { id } });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      // Toggle active status
      institution.is_active = !institution.is_active;
      await institutionRepo.save(institution);

      res.json({
        success: true,
        message: `Institution ${institution.is_active ? "activated" : "deactivated"} successfully`,
        data: institution,
      });
    } catch (error: any) {
      console.error("❌ Toggle institution status error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update institution status",
        error: error.message,
      });
    }
  }
  // ==================== CHECK INSTITUTION ADMIN ====================
  static checkInstitutionAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      const institutionId = req.params.id || req.body.institution_id;

      if (!userId || !institutionId) {
        return res.status(400).json({
          success: false,
          message: "User ID and Institution ID required",
        });
      }

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const member = await memberRepo.findOne({
        where: {
          user_id: userId,
          institution_id: institutionId,
          is_active: true,
        },
      });

      if (!member || member.role !== "ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You must be an administrator of this institution",
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Access control check failed",
        error: error.message,
      });
    }
  };

  // ==================== CHECK INSTITUTION MEMBER ====================
  static checkInstitutionMember = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      const institutionId = req.params.id || req.body.institution_id;

      if (!userId || !institutionId) {
        return res.status(400).json({
          success: false,
          message: "User ID and Institution ID required",
        });
      }

      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const member = await memberRepo.findOne({
        where: {
          user_id: userId,
          institution_id: institutionId,
          is_active: true,
        },
      });

      if (!member) {
        return res.status(403).json({
          success: false,
          message: "You must be a member of this institution",
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Access control check failed",
        error: error.message,
      });
    }
  };

  // ==================== CHECK COURSE INSTRUCTOR ====================
  static checkCourseInstructor = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      const courseId = req.params.id || req.body.course_id;

      if (!userId || !courseId) {
        return res.status(400).json({
          success: false,
          message: "User ID and Course ID required",
        });
      }

      const instructorRepo = dbConnection.getRepository(CourseInstructor);
      const courseRepo = dbConnection.getRepository(Course);

      // Check if primary instructor
      const course = await courseRepo.findOne({ where: { id: courseId } });
      if (course && course.instructor_id === userId) {
        return next();
      }

      // Check if assigned instructor
      const assignment = await instructorRepo.findOne({
        where: { course_id: courseId, instructor_id: userId },
      });

      if (!assignment) {
        return res.status(403).json({
          success: false,
          message: "You must be assigned to this course",
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Access control check failed",
        error: error.message,
      });
    }
  };

  // ==================== CHECK SPOC ACCESS ====================
  static checkSPOCAccess = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      const courseId = req.params.id || req.body.course_id;

      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: "Course ID required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id: courseId } });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Allow access to MOOC courses
      if (course.course_type === CourseType.MOOC) {
        return next();
      }

      // SPOC course - check access
      if (!userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied to this private course",
        });
      }

      // Check institution membership
      if (course.institution_id) {
        const memberRepo = dbConnection.getRepository(InstitutionMember);
        const member = await memberRepo.findOne({
          where: {
            user_id: userId,
            institution_id: course.institution_id,
            is_active: true,
          },
        });

        if (member) {
          return next();
        }
      }

      // Check enrollment
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const enrollment = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id: courseId },
      });

      if (enrollment) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: "Access denied to this private course",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Access control check failed",
        error: error.message,
      });
    }
  };

  // ==================== CHECK ENROLLMENT ACCESS ====================
  static checkEnrollmentAccess = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      const courseId = req.params.id || req.body.course_id;

      if (!userId || !courseId) {
        return res.status(401).json({
          success: false,
          message: "Authentication and Course ID required",
        });
      }

      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const enrollment = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id: courseId },
      });

      if (!enrollment || enrollment.status === "DROPPED") {
        return res.status(403).json({
          success: false,
          message: "You must be enrolled in this course",
        });
      }

      next();
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Access control check failed",
        error: error.message,
      });
    }
  };



  
}