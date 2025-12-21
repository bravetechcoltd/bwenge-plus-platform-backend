// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Institution } from "../database/models/Institution";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { User } from "../database/models/User";
import { Course } from "../database/models/Course";
import { Enrollment } from "../database/models/Enrollment";
import { CourseCategory } from "../database/models/CourseCategory";
import { Between } from "typeorm";
import { EnrollmentApprovalStatus } from "../database/models/Enrollment";

export class InstitutionAdminController {
  // ==================== GET INSTITUTION ADMIN DASHBOARD DATA ====================
  static async getAdminDashboard(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;

      if (!institutionId) {
        return res.status(400).json({
          success: false,
          message: "Institution ID is required",
        });
      }

      // Get institution
      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({
        where: { id: institutionId },
        select: ["id", "name", "logo_url", "type", "is_active"]
      });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      // Get stats - CALL PRIVATE METHODS PROPERLY
      const [
        totalCourses,
        activeCourses,
        totalInstructors,
        activeInstructors,
        totalStudentsResult,
        activeStudentsResult,
        pendingApprovals,
        revenueThisMonth,
        topCourses,
        recentActivity,
        pendingRequests
      ] = await Promise.all([
        // Total courses count
        dbConnection.getRepository(Course).count({
          where: { institution_id: institutionId }
        }),

        // Active courses (published)
        dbConnection.getRepository(Course).count({
          where: {
            institution_id: institutionId,
            status: "PUBLISHED"
          }
        }),

        // Total instructors count
        dbConnection.getRepository(InstitutionMember).count({
          where: {
            institution_id: institutionId,
            role: "INSTRUCTOR",
            is_active: true
          }
        }),

        // Active instructors (users who are active)
        dbConnection.getRepository(InstitutionMember).createQueryBuilder("member")
          .innerJoin("member.user", "user")
          .where("member.institution_id = :institutionId", { institutionId })
          .andWhere("member.role = :role", { role: "INSTRUCTOR" })
          .andWhere("member.is_active = true")
          .andWhere("user.is_active = true")
          .getCount(),

        // Total students count (distinct users enrolled in institution courses)
        dbConnection.getRepository(Enrollment)
          .createQueryBuilder("enrollment")
          .innerJoin("enrollment.course", "course")
          .select("COUNT(DISTINCT enrollment.user_id)", "count")
          .where("course.institution_id = :institutionId", { institutionId })
          .getRawOne(),

        // Active students (enrolled in active courses)
        dbConnection.getRepository(Enrollment)
          .createQueryBuilder("enrollment")
          .innerJoin("enrollment.course", "course")
          .select("COUNT(DISTINCT enrollment.user_id)", "count")
          .where("course.institution_id = :institutionId", { institutionId })
          .andWhere("course.status = :status", { status: "PUBLISHED" })
          .andWhere("enrollment.status = :enrollmentStatus", { enrollmentStatus: "ACTIVE" })
          .getRawOne(),

        // Pending approval enrollments
        dbConnection.getRepository(Enrollment).count({
          where: {
            approval_status: EnrollmentApprovalStatus.PENDING,
            course: {
              institution_id: institutionId
            }
          }
        }),

        // Revenue this month - CALL STATIC METHOD CORRECTLY
        InstitutionAdminController.getMonthlyRevenue(institutionId),

        // Top performing courses - CALL STATIC METHOD CORRECTLY
        InstitutionAdminController.getTopCourses(institutionId),

        // Recent activity - CALL STATIC METHOD CORRECTLY
        InstitutionAdminController.getRecentActivity(institutionId),

        // Pending requests - CALL STATIC METHOD CORRECTLY
        InstitutionAdminController.getPendingRequests(institutionId)
      ]);

      // Get total categories
      const totalCategories = await dbConnection.getRepository(CourseCategory).count({
        where: { institution_id: institutionId }
      });

      // Get quick actions
      const quickActions = InstitutionAdminController.getQuickActions(institutionId);

      res.json({
        success: true,
        data: {
          institution,
          stats: {
            totalCourses,
            activeCourses,
            totalInstructors,
            activeInstructors,
            totalStudents: parseInt(totalStudentsResult?.count) || 0,
            activeStudents: parseInt(activeStudentsResult?.count) || 0,
            pendingApprovals,
            revenueThisMonth,
            totalCategories
          },
          topCourses,
          recentActivity,
          pendingRequests,
          quickActions
        }
      });

    } catch (error: any) {
      console.error("❌ Get admin dashboard error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch dashboard data",
        error: error.message,
      });
    }
  }

  // ==================== GET MONTHLY REVENUE ====================
  private static async getMonthlyRevenue(institutionId: string): Promise<number> {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const endOfMonth = new Date(startOfMonth);
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      endOfMonth.setDate(0);

      // Sum of course prices for enrollments this month
      const result = await dbConnection.getRepository(Enrollment)
        .createQueryBuilder("enrollment")
        .innerJoin("enrollment.course", "course")
        .select("SUM(course.price)", "total")
        .where("course.institution_id = :institutionId", { institutionId })
        .andWhere("enrollment.enrolled_at BETWEEN :start AND :end", {
          start: startOfMonth,
          end: endOfMonth
        })
        .getRawOne();

      return parseFloat(result?.total || "0");
    } catch (error) {
      console.error("❌ Revenue calculation error:", error);
      return 0;
    }
  }

  // ==================== GET TOP COURSES ====================
  private static async getTopCourses(institutionId: string): Promise<any[]> {
    try {
      const courses = await dbConnection.getRepository(Course)
        .createQueryBuilder("course")
        .leftJoin("course.enrollments", "enrollment")
        .leftJoin("course.instructor", "instructor")
        .select([
          "course.id",
          "course.title",
          "course.thumbnail_url",
          "course.enrollment_count",
          "course.completion_rate",
          "course.average_rating",
          "instructor.first_name",
          "instructor.last_name",
          "instructor.profile_picture_url"
        ])
        .addSelect("COUNT(enrollment.id)", "enrollmentCount")
        .where("course.institution_id = :institutionId", { institutionId })
        .andWhere("course.status = :status", { status: "PUBLISHED" })
        .groupBy("course.id, instructor.id")
        .orderBy("course.enrollment_count", "DESC")
        .limit(5)
        .getRawMany();

      return courses.map(course => ({
        id: course.course_id,
        name: course.course_title,
        instructor: {
          name: `${course.instructor_first_name || ''} ${course.instructor_last_name || ''}`.trim(),
          profile_picture_url: course.instructor_profile_picture_url
        },
        students: parseInt(course.enrollmentCount) || 0,
        completion: parseFloat(course.course_completion_rate) || 0,
        rating: parseFloat(course.course_average_rating) || 0,
        status: "active"
      }));
    } catch (error) {
      console.error("❌ Top courses error:", error);
      return [];
    }
  }

  // ==================== GET RECENT ACTIVITY ====================
  private static async getRecentActivity(institutionId: string): Promise<any[]> {
    try {
      // Get recent course creations
      const recentCourses = await dbConnection.getRepository(Course)
        .createQueryBuilder("course")
        .leftJoin("course.instructor", "instructor")
        .select([
          "course.id",
          "course.title",
          "course.created_at",
          "instructor.first_name",
          "instructor.last_name"
        ])
        .where("course.institution_id = :institutionId", { institutionId })
        .orderBy("course.created_at", "DESC")
        .limit(5)
        .getMany();

      // Get recent enrollments
      const recentEnrollments = await dbConnection.getRepository(Enrollment)
        .createQueryBuilder("enrollment")
        .leftJoin("enrollment.course", "course")
        .leftJoin("enrollment.user", "user")
        .select([
          "enrollment.id",
          "enrollment.enrolled_at",
          "course.title",
          "user.first_name",
          "user.last_name"
        ])
        .where("course.institution_id = :institutionId", { institutionId })
        .orderBy("enrollment.enrolled_at", "DESC")
        .limit(5)
        .getMany();

      // Format activity items
      const activities = [
        ...recentCourses.map(course => ({
          id: `course-${course.id}`,
          action: "Course Created",
          description: course.title,
          user: `${course.instructor?.first_name || ''} ${course.instructor?.last_name || ''}`.trim(),
          timestamp: course.created_at,
          status: "completed" as const
        })),
        ...recentEnrollments.map(enrollment => ({
          id: `enrollment-${enrollment.id}`,
          action: "Student Enrolled",
          description: `Enrolled in ${enrollment.course?.title || 'course'}`,
          user: `${enrollment.user?.first_name || ''} ${enrollment.user?.last_name || ''}`.trim(),
          timestamp: enrollment.enrolled_at,
          status: "completed" as const
        }))
      ];

      return activities.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ).slice(0, 8);
    } catch (error) {
      console.error("❌ Recent activity error:", error);
      return [];
    }
  }

  // ==================== GET PENDING REQUESTS ====================
  private static async getPendingRequests(institutionId: string): Promise<any[]> {
    try {
      // Pending enrollment approvals
      const pendingEnrollments = await dbConnection.getRepository(Enrollment)
        .createQueryBuilder("enrollment")
        .leftJoin("enrollment.course", "course")
        .leftJoin("enrollment.user", "user")
        .select([
          "enrollment.id",
          "enrollment.enrolled_at",
          "course.title",
          "user.email",
          "user.first_name",
          "user.last_name"
        ])
        .where("course.institution_id = :institutionId", { institutionId })
        .andWhere("enrollment.approval_status = :status", { status: "PENDING" })
        .orderBy("enrollment.enrolled_at", "DESC")
        .limit(5)
        .getMany();

      // ✅ FIX: Use innerJoinAndSelect instead of innerJoin with manual select
      // This properly loads the user relation and avoids SQL syntax errors
      const pendingInstructors = await dbConnection.getRepository(InstitutionMember)
        .createQueryBuilder("member")
        .innerJoinAndSelect("member.user", "user")
        .where("member.institution_id = :institutionId", { institutionId })
        .andWhere("member.role = :role", { role: "MEMBER" })
        .andWhere("user.bwenge_role IN (:...roles)", { 
          roles: ["INSTRUCTOR", "CONTENT_CREATOR"] 
        })
        .limit(5)
        .getMany();

      return [
        ...pendingEnrollments.map(enrollment => ({
          id: enrollment.id,
          type: "Enrollment Approval",
          course: enrollment.course?.title || "Unknown Course",
          student: enrollment.user?.email || "Unknown User",
          submittedAt: enrollment.enrolled_at,
          status: "pending" as const
        })),
        ...pendingInstructors.map(member => ({
          id: member.user.id,
          type: "Instructor Request",
          course: "Role Change Request",
          instructor: member.user.email,
          submittedAt: member.joined_at || member.user.date_joined,
          status: "pending" as const
        }))
      ];
    } catch (error) {
      console.error("❌ Pending requests error:", error);
      return [];
    }
  }

  // ==================== GET QUICK ACTIONS ====================
  private static getQuickActions(institutionId: string) {
    return [
      {
        title: "Create Course",
        description: "Launch new SPOC course",
        icon: "PlusCircle",
        href: `/dashboard/institution-admin/courses/create?institution=${institutionId}`,
        color: "from-blue-500 to-cyan-500",
        action: "create_spoc_course"
      },
      {
        title: "Invite Instructor",
        description: "Add new teaching staff",
        icon: "UserPlus",
        href: `/dashboard/institution-admin/users/invite?institution=${institutionId}`,
        color: "from-green-500 to-emerald-500",
        action: "invite_instructor"
      },
      {
        title: "Generate Access Codes",
        description: "Create enrollment codes",
        icon: "Key",
        href: `/dashboard/institution-admin/enrollment/access-codes?institution=${institutionId}`,
        color: "from-purple-500 to-pink-500",
        action: "generate_access_codes"
      },
      {
        title: "Bulk Enrollment",
        description: "Import students via CSV",
        icon: "Upload",
        href: `/dashboard/institution-admin/enrollment/bulk?institution=${institutionId}`,
        color: "from-orange-500 to-amber-500",
        action: "bulk_enroll"
      }
    ];
  }

  // ==================== GET INSTITUTION BASIC INFO ====================
  static async getInstitutionBasicInfo(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;

      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({
        where: { id: institutionId },
        select: [
          "id", "name", "logo_url", "type", "description", 
          "is_active", "created_at", "updated_at", "settings"
        ]
      });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      // Get member counts
      const [memberCount, instructorCount] = await Promise.all([
        dbConnection.getRepository(InstitutionMember).count({
          where: { institution_id: institutionId, is_active: true }
        }),
        dbConnection.getRepository(InstitutionMember).count({
          where: {
            institution_id: institutionId,
            role: "INSTRUCTOR",
            is_active: true
          }
        })
      ]);

      res.json({
        success: true,
        data: {
          institution,
          counts: {
            members: memberCount,
            instructors: instructorCount,
            courses: await dbConnection.getRepository(Course).count({
              where: { institution_id: institutionId }
            })
          }
        }
      });
    } catch (error: any) {
      console.error("❌ Get institution info error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch institution information",
        error: error.message,
      });
    }
  }

  // ==================== GET INSTITUTION COURSES ====================
  static async getInstitutionCourses(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;
      const { page = 1, limit = 10, status } = req.query;

      if (!institutionId) {
        return res.status(400).json({
          success: false,
          message: "Institution ID is required",
        });
      }

      const pageNumber = parseInt(page as string);
      const limitNumber = parseInt(limit as string);
      const skip = (pageNumber - 1) * limitNumber;

      const courseRepo = dbConnection.getRepository(Course);
      const queryBuilder = courseRepo.createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.course_category", "category")
        .where("course.institution_id = :institutionId", { institutionId });

      if (status) {
        queryBuilder.andWhere("course.status = :status", { status });
      }

      const [courses, total] = await queryBuilder
        .orderBy("course.created_at", "DESC")
        .skip(skip)
        .take(limitNumber)
        .getManyAndCount();

      res.json({
        success: true,
        data: {
          courses,
          pagination: {
            page: pageNumber,
            limit: limitNumber,
            total,
            totalPages: Math.ceil(total / limitNumber)
          }
        }
      });
    } catch (error: any) {
      console.error("❌ Get institution courses error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch institution courses",
        error: error.message,
      });
    }
  }

  // ==================== GET INSTITUTION INSTRUCTORS ====================
  static async getInstitutionInstructors(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;

      if (!institutionId) {
        return res.status(400).json({
          success: false,
          message: "Institution ID is required",
        });
      }

      const instructors = await dbConnection.getRepository(InstitutionMember)
        .createQueryBuilder("member")
        .innerJoinAndSelect("member.user", "user")
        .where("member.institution_id = :institutionId", { institutionId })
        .andWhere("member.role = :role", { role: "INSTRUCTOR" })
        .andWhere("member.is_active = true")
        .orderBy("member.joined_at", "DESC")
        .getMany();

      res.json({
        success: true,
        data: instructors.map(member => ({
          id: member.user.id,
          email: member.user.email,
          first_name: member.user.first_name,
          last_name: member.user.last_name,
          profile_picture_url: member.user.profile_picture_url,
          joined_at: member.joined_at,
          additional_permissions: member.additional_permissions
        }))
      });
    } catch (error: any) {
      console.error("❌ Get institution instructors error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch institution instructors",
        error: error.message,
      });
    }
  }

  // ==================== GET INSTITUTION ENROLLMENTS ====================
  static async getInstitutionEnrollments(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;
      const { page = 1, limit = 10, status, approval_status } = req.query;

      if (!institutionId) {
        return res.status(400).json({
          success: false,
          message: "Institution ID is required",
        });
      }

      const pageNumber = parseInt(page as string);
      const limitNumber = parseInt(limit as string);
      const skip = (pageNumber - 1) * limitNumber;

      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const queryBuilder = enrollmentRepo.createQueryBuilder("enrollment")
        .innerJoinAndSelect("enrollment.course", "course")
        .innerJoinAndSelect("enrollment.user", "user")
        .where("course.institution_id = :institutionId", { institutionId });

      if (status) {
        queryBuilder.andWhere("enrollment.status = :status", { status });
      }

      if (approval_status) {
        queryBuilder.andWhere("enrollment.approval_status = :approval_status", { approval_status });
      }

      const [enrollments, total] = await queryBuilder
        .orderBy("enrollment.enrolled_at", "DESC")
        .skip(skip)
        .take(limitNumber)
        .getManyAndCount();

      res.json({
        success: true,
        data: {
          enrollments,
          pagination: {
            page: pageNumber,
            limit: limitNumber,
            total,
            totalPages: Math.ceil(total / limitNumber)
          }
        }
      });
    } catch (error: any) {
      console.error("❌ Get institution enrollments error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch institution enrollments",
        error: error.message,
      });
    }
  }
}