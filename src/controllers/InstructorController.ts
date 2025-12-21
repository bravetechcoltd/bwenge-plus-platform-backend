// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { User, BwengeRole } from "../database/models/User";
import { Course, CourseStatus, CourseType } from "../database/models/Course";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { LessonProgress } from "../database/models/LessonProgress";
import { Review } from "../database/models/ReviewModel";
import { Progress } from "../database/models/Progress";
import { Module } from "../database/models/Module";
import { Lesson } from "../database/models/Lesson";
import { Assessment } from "../database/models/Assessment";
import { In } from "typeorm";

export class InstructorController {

  static async getAllInstructorStudents(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { instructorId } = req.params;
    
    if (!userId || userId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        error: "FORBIDDEN"
      });
    }

    const {
      search,
      page = "1",
      limit = "20"
    } = req.query;

    const pageNumber = parseInt(page as string);
    const limitNumber = Math.min(parseInt(limit as string), 50);
    const skip = (pageNumber - 1) * limitNumber;

    const courseRepo = dbConnection.getRepository(Course);
    const courses = await courseRepo
      .createQueryBuilder("course")
      .select(["course.id", "course.title"])
      .where(
        `(
          course.instructor_id = :userId 
          OR EXISTS (
            SELECT 1 FROM course_instructors ci 
            WHERE ci.course_id = course.id 
            AND ci.instructor_id = :userId 
            AND ci.can_edit_course_content = true
          )
        )`,
        { userId }
      )
      .getMany();

    const courseIds = courses.map(c => c.id);

    if (courseIds.length === 0) {
      return res.json({
        success: true,
        instructorId,
        studentCount: 0,
        students: [],
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total: 0,
          totalPages: 0
        }
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const studentMap = new Map();
    
    const enrollments = await enrollmentRepo
      .createQueryBuilder("enrollment")
      .leftJoinAndSelect("enrollment.user", "user")
      .leftJoinAndSelect("enrollment.course", "course")
      .where("enrollment.course_id IN (:...courseIds)", { courseIds })
      .andWhere("enrollment.status IN (:...statuses)", { 
        statuses: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] 
      })
      .andWhere("user.is_active = true")
      .getMany();

    enrollments.forEach(enrollment => {
      const student = enrollment.user;
      const course = enrollment.course;
      
      if (!studentMap.has(student.id)) {
        studentMap.set(student.id, {
          student: {
            id: student.id,
            email: student.email,
            firstName: student.first_name,
            lastName: student.last_name,
            totalPoints: student.total_learning_hours || 0,
            level: Math.floor((student.total_learning_hours || 0) / 100) + 1,
            streakDays: 0,
            profilePicUrl: student.profile_picture_url,
            isActive: student.is_active,
            isEmailVerified: student.is_verified,
            createdAt: student.date_joined,
            updatedAt: student.updated_at
          },
          courses: []
        });
      }
      
      const studentData = studentMap.get(student.id);
      if (!studentData.courses.some((c: any) => c.id === course.id)) {
        studentData.courses.push({
          id: course.id,
          title: course.title,
          level: course.level,
          completion_percentage: enrollment.progress_percentage || 0,
          status: enrollment.status,
          enrolled_at: enrollment.enrolled_at
        });
      }
    });

    let studentsArray = Array.from(studentMap.values());
    
    if (search) {
      const searchLower = search.toString().toLowerCase();
      studentsArray = studentsArray.filter(item =>
        item.student.firstName?.toLowerCase().includes(searchLower) ||
        item.student.lastName?.toLowerCase().includes(searchLower) ||
        item.student.email?.toLowerCase().includes(searchLower)
      );
    }

    const totalCount = studentsArray.length;
    const paginatedStudents = studentsArray.slice(skip, skip + limitNumber);

    res.json({
      success: true,
      instructorId,
      studentCount: totalCount,
      students: paginatedStudents,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNumber)
      }
    });

  } catch (error: any) {
    console.error("❌ Get all instructor students error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch instructor's students",
      error: error.message
    });
  }
}
  // ==================== METHOD 1: Get Instructor's Assigned Courses ====================
  static async getInstructorCourses(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required. Please log in.",
          error: "UNAUTHORIZED"
        });
      }

      // Get authenticated user
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
          message: "You don't have instructor privileges.",
          error: "FORBIDDEN"
        });
      }

      // Get query parameters
      const {
        status,
        course_type,
        institution_id,
        search,
        sort_by = "created_at",
        sort_order = "DESC",
        page = "1",
        limit = "10",
        include_stats = "true"
      } = req.query;

      const pageNumber = parseInt(page as string);
      const limitNumber = Math.min(parseInt(limit as string), 50);
      const skip = (pageNumber - 1) * limitNumber;
      const includeStatistics = include_stats === "true";

      // Build base query
      const courseRepo = dbConnection.getRepository(Course);
      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.institution", "institution")
        .leftJoinAndSelect("course.course_category", "category")
        .leftJoinAndSelect("course.instructor", "primary_instructor")
        .where(
          `(
            course.instructor_id = :userId 
            OR EXISTS (
              SELECT 1 FROM course_instructors ci 
              WHERE ci.course_id = course.id 
              AND ci.instructor_id = :userId 
              AND ci.can_edit_course_content = true
            )
          )`,
          { userId }
        );

      // Apply filters
      if (status && Object.values(CourseStatus).includes(status as CourseStatus)) {
        queryBuilder.andWhere("course.status = :status", { status });
      }

      if (course_type && Object.values(CourseType).includes(course_type as CourseType)) {
        queryBuilder.andWhere("course.course_type = :course_type", { course_type });
      }

      if (institution_id) {
        queryBuilder.andWhere("course.institution_id = :institution_id", { institution_id });
      }

      if (search) {
        queryBuilder.andWhere(
          "(course.title ILIKE :search OR course.description ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      // Get total count before pagination
      const total = await queryBuilder.getCount();

      // Apply sorting
      switch (sort_by) {
        case "title":
          queryBuilder.orderBy("course.title", sort_order as "ASC" | "DESC");
          break;
        case "enrollment_count":
          queryBuilder.orderBy("course.enrollment_count", sort_order as "ASC" | "DESC");
          break;
        case "status":
          queryBuilder.orderBy("course.status", sort_order as "ASC" | "DESC");
          break;
        case "created_at":
        default:
          queryBuilder.orderBy("course.created_at", sort_order as "ASC" | "DESC");
          break;
      }

      // Apply pagination
      const courses = await queryBuilder
        .skip(skip)
        .take(limitNumber)
        .getMany();

      // Get instructor role and permissions for each course
      const coursesWithRole = await Promise.all(
        courses.map(async (course) => {
          const isPrimary = course.instructor_id === userId;
          
          let instructorRole = {
            is_primary: isPrimary,
            permissions: {
              can_grade_assignments: isPrimary,
              can_manage_enrollments: isPrimary,
              can_edit_course_content: isPrimary
            },
            assigned_at: course.created_at
          };

          // If not primary, check additional instructor permissions
          if (!isPrimary) {
            const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);
            const additionalInstructor = await courseInstructorRepo.findOne({
              where: {
                course_id: course.id,
                instructor_id: userId
              }
            });

            if (additionalInstructor) {
              instructorRole = {
                is_primary: false,
                permissions: {
                  can_grade_assignments: additionalInstructor.can_grade_assignments,
                  can_manage_enrollments: additionalInstructor.can_manage_enrollments,
                  can_edit_course_content: additionalInstructor.can_edit_course_content
                },
                assigned_at: additionalInstructor.assigned_at
              };
            }
          }

          // Get statistics if requested
          let statistics = null;
          if (includeStatistics) {
            statistics = await InstructorController.getCourseStatistics(course.id);
          }

          // Determine available actions
          const availableActions = ["view_students", "view_analytics"];
          if (instructorRole.permissions.can_grade_assignments) {
            availableActions.push("grade_assignments");
          }
          if (instructorRole.permissions.can_manage_enrollments) {
            availableActions.push("manage_enrollments");
          }
          if (instructorRole.permissions.can_edit_course_content) {
            availableActions.push("edit_content");
          }

          return {
            // Course Basic Info
            id: course.id,
            title: course.title,
            description: course.description,
            short_description: course.short_description,
            thumbnail_url: course.thumbnail_url,
            status: course.status,
            course_type: course.course_type,
            level: course.level,
            language: course.language,
            created_at: course.created_at,
            updated_at: course.updated_at,
            published_at: course.published_at,
            
            // Institution Info
            institution: course.institution ? {
              id: course.institution.id,
              name: course.institution.name,
              logo_url: course.institution.logo_url,
              type: course.institution.type
            } : null,
            
            // Category Info
            category: course.course_category ? {
              id: course.course_category.id,
              name: course.course_category.name,
              description: course.course_category.description
            } : null,
            
            // Primary Instructor Info
            primary_instructor: course.instructor ? {
              id: course.instructor.id,
              first_name: course.instructor.first_name,
              last_name: course.instructor.last_name,
              email: course.instructor.email,
              profile_picture_url: course.instructor.profile_picture_url
            } : null,
            
            // Current User's Role
            instructor_role: instructorRole,
            
            // Statistics
            statistics: statistics,
            
            // Quick Actions
            available_actions: availableActions
          };
        })
      );

      // Get summary counts
      const summary = await InstructorController.getCoursesSummary(userId, {
        status: status as CourseStatus,
        course_type: course_type as CourseType,
        institution_id: institution_id as string,
        search: search as string
      });

      res.json({
        success: true,
        data: {
          courses: coursesWithRole,
          pagination: {
            page: pageNumber,
            limit: limitNumber,
            total,
            totalPages: Math.ceil(total / limitNumber)
          },
          summary
        }
      });

    } catch (error: any) {
      console.error("❌ Get instructor courses error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch instructor courses",
        error: error.message
      });
    }
  }

  // ==================== METHOD 2: Get Instructor Dashboard Summary ====================
  static async getDashboardSummary(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required. Please log in.",
          error: "UNAUTHORIZED"
        });
      }

      // Get user
      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId } });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Get all courses where user is instructor
      const courseRepo = dbConnection.getRepository(Course);
      const courses = await courseRepo
        .createQueryBuilder("course")
        .where(
          `(
            course.instructor_id = :userId 
            OR EXISTS (
              SELECT 1 FROM course_instructors ci 
              WHERE ci.course_id = course.id 
              AND ci.instructor_id = :userId 
              AND ci.can_edit_course_content = true
            )
          )`,
          { userId }
        )
        .getMany();

      // Calculate overall statistics
      const overview = {
        total_courses: courses.length,
        active_courses: courses.filter(c => c.status === CourseStatus.PUBLISHED).length,
        draft_courses: courses.filter(c => c.status === CourseStatus.DRAFT).length,
        archived_courses: courses.filter(c => c.status === CourseStatus.ARCHIVED).length,
        mooc_courses: courses.filter(c => c.course_type === CourseType.MOOC).length,
        spoc_courses: courses.filter(c => c.course_type === CourseType.SPOC).length,
        primary_instructor_count: courses.filter(c => c.instructor_id === userId).length,
        additional_instructor_count: courses.filter(c => c.instructor_id !== userId).length
      };

      // Calculate student statistics
      const studentStats = await InstructorController.getStudentStatistics(userId);

      // Calculate engagement metrics
      const engagement = await InstructorController.getEngagementMetrics(courses);

      // Get recent activity
      const recentActivity = await InstructorController.getRecentActivity(userId);

      // Get content statistics
      const content = await InstructorController.getContentStatistics(courses);

      // Get attention required items
      const attentionRequired = await InstructorController.getAttentionRequiredItems(userId, courses);

      // Get top performing courses
      const topCourses = await InstructorController.getTopPerformingCourses(courses);

      // Get institution summary
      const institutions = await InstructorController.getInstitutionSummary(userId);

      // Get quick actions
      const quickActions = InstructorController.getQuickActions(attentionRequired);

      res.json({
        success: true,
        data: {
          overview,
          students: studentStats,
          engagement,
          recent_activity: recentActivity,
          content,
          attention_required: attentionRequired,
          top_courses: topCourses,
          institutions,
          quick_actions: quickActions
        }
      });

    } catch (error: any) {
      console.error("❌ Get dashboard summary error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch dashboard summary",
        error: error.message
      });
    }
  }

  // ==================== METHOD 3: Get Students for Instructor's Course ====================
  static async getCourseStudents(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { courseId } = req.params;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
          error: "UNAUTHORIZED"
        });
      }

      // Verify course access
      const hasAccess = await InstructorController.verifyCourseAccess(courseId, userId);
      if (!hasAccess.access) {
        return res.status(403).json({
          success: false,
          message: "You don't have access to this course",
          error: "FORBIDDEN"
        });
      }

      // Check if additional instructor has permission to manage enrollments
      if (!hasAccess.isPrimary && !hasAccess.permissions?.can_manage_enrollments) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view students for this course",
          error: "FORBIDDEN"
        });
      }

      // Get query parameters
      const {
        status,
        search,
        sort_by = "enrolled_at",
        sort_order = "DESC",
        progress_filter,
        page = "1",
        limit = "20",
        include_details = "true"
      } = req.query;

      const pageNumber = parseInt(page as string);
      const limitNumber = Math.min(parseInt(limit as string), 50);
      const skip = (pageNumber - 1) * limitNumber;
      const includeDetails = include_details === "true";

      // Get course details
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({
        where: { id: courseId },
        relations: ["modules", "lessons"]
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found"
        });
      }

      // Build enrollment query - FIXED: Removed problematic lesson_progress join
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const queryBuilder = enrollmentRepo
        .createQueryBuilder("enrollment")
        .innerJoinAndSelect("enrollment.user", "student")
        .where("enrollment.course_id = :courseId", { courseId })
        .andWhere("student.is_active = true");

      // Apply filters
      if (status && Object.values(EnrollmentStatus).includes(status as EnrollmentStatus)) {
        queryBuilder.andWhere("enrollment.status = :status", { status });
      }

      if (search) {
        queryBuilder.andWhere(
          "(student.first_name ILIKE :search OR student.last_name ILIKE :search OR student.email ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      if (progress_filter) {
        switch (progress_filter) {
          case "not_started":
            queryBuilder.andWhere("enrollment.completion_percentage = 0");
            break;
          case "in_progress":
            queryBuilder.andWhere("enrollment.completion_percentage > 0 AND enrollment.completion_percentage < 100");
            break;
          case "completed":
            queryBuilder.andWhere("enrollment.completion_percentage = 100");
            break;
        }
      }

      // Get total count
      const total = await queryBuilder.getCount();

      // Apply sorting
      switch (sort_by) {
        case "name":
          queryBuilder.orderBy("student.first_name", sort_order as "ASC" | "DESC")
                     .addOrderBy("student.last_name", sort_order as "ASC" | "DESC");
          break;
        case "progress":
          queryBuilder.orderBy("enrollment.completion_percentage", sort_order as "ASC" | "DESC");
          break;
        case "last_activity":
          queryBuilder.orderBy("enrollment.last_accessed", sort_order as "ASC" | "DESC");
          break;
        case "enrolled_at":
        default:
          queryBuilder.orderBy("enrollment.enrolled_at", sort_order as "ASC" | "DESC");
          break;
      }

      // Apply pagination
      const enrollments = await queryBuilder
        .skip(skip)
        .take(limitNumber)
        .getMany();

      // Process students with detailed progress
      const students = await Promise.all(
        enrollments.map(async (enrollment) => {
          const student = enrollment.user;
          
          // Calculate detailed progress if requested
          let details = null;
          if (includeDetails) {
            details = await InstructorController.getStudentProgressDetails(courseId, student.id, course);
          }

          // Determine at-risk status
          const atRisk = await InstructorController.checkStudentAtRisk(enrollment, details);

          // Get available actions
          const availableActions = ["send_message", "view_progress_details", "view_submission_history"];
          if (hasAccess.permissions?.can_manage_enrollments) {
            availableActions.push("unenroll");
          }

          return {
            // Student Basic Info
            student: {
              id: student.id,
              first_name: student.first_name,
              last_name: student.last_name,
              email: student.email,
              profile_picture_url: student.profile_picture_url,
              country: student.country,
              city: student.city
            },
            
            // Enrollment Info
            enrollment: {
              id: enrollment.id,
              status: enrollment.status,
              enrolled_at: enrollment.enrolled_at,
              started_at: enrollment.started_at,
              completed_at: enrollment.completed_at,
              last_accessed_at: enrollment.last_accessed,
              days_since_enrollment: Math.floor(
                (Date.now() - new Date(enrollment.enrolled_at).getTime()) / (1000 * 60 * 60 * 24)
              ),
              days_since_last_activity: enrollment.last_accessed 
                ? Math.floor((Date.now() - new Date(enrollment.last_accessed).getTime()) / (1000 * 60 * 60 * 24))
                : null
            },
            
            // Progress Summary
            progress: {
              completion_percentage: enrollment.completion_percentage || 0,
              rank: 0, // Would need to calculate ranking
              lessons: {
                total: course.total_lessons || 0,
                completed: details?.lessons_completed || 0,
                in_progress: 0,
                not_started: course.total_lessons - (details?.lessons_completed || 0),
                completion_rate: course.total_lessons > 0 
                  ? Math.round(((details?.lessons_completed || 0) / course.total_lessons) * 100)
                  : 0
              },
              modules: {
                total: course.modules?.length || 0,
                completed: details?.modules_completed || 0,
                in_progress: 0,
                current_module: details?.current_module || null
              },
              assessments: {
                total: 0,
                completed: 0,
                passed: 0,
                failed: 0,
                pending: 0,
                average_score: 0,
                highest_score: 0,
                lowest_score: 0
              }
            },
            
            // Detailed Progress
            details: details,
            
            // Contact
            contact: {
              last_message_sent: null,
              unread_messages: 0
            },
            
            // Performance Indicators
            performance_indicators: {
              engagement_score: 0,
              completion_velocity: "average",
              at_risk: atRisk,
              risk_factors: atRisk ? ["inactive_7_days"] : []
            },
            
            // Quick Actions
            available_actions: availableActions
          };
        })
      );

      // Calculate aggregate statistics
      const statistics = await InstructorController.getStudentsStatistics(courseId, {
        status: status as EnrollmentStatus,
        progress_filter: progress_filter as string
      });

      res.json({
        success: true,
        data: {
          course: {
            id: course.id,
            title: course.title,
            total_students: total,
            total_modules: course.modules?.length || 0,
            total_lessons: course.total_lessons || 0,
            total_assessments: 0
          },
          students,
          pagination: {
            page: pageNumber,
            limit: limitNumber,
            total,
            totalPages: Math.ceil(total / limitNumber)
          },
          statistics,
          filters: {
            status: status || null,
            search: search || null,
            progress_filter: progress_filter || null,
            sort_by,
            sort_order
          }
        }
      });

    } catch (error: any) {
      console.error("❌ Get course students error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch course students",
        error: error.message
      });
    }
  }


  // ==================== GET MY STUDENTS (SIMPLER ENDPOINT) ====================
static async getMyStudents(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "UNAUTHORIZED"
      });
    }

    // Get query parameters
    const {
      search,
      page = "1",
      limit = "20"
    } = req.query;

    const pageNumber = parseInt(page as string);
    const limitNumber = Math.min(parseInt(limit as string), 50);
    const skip = (pageNumber - 1) * limitNumber;

    // Get all courses where user is instructor
    const courseRepo = dbConnection.getRepository(Course);
    const courses = await courseRepo
      .createQueryBuilder("course")
      .select(["course.id", "course.title"])
      .where(
        `(
          course.instructor_id = :userId 
          OR EXISTS (
            SELECT 1 FROM course_instructors ci 
            WHERE ci.course_id = course.id 
            AND ci.instructor_id = :userId 
            AND ci.can_edit_course_content = true
          )
        )`,
        { userId }
      )
      .getMany();

    const courseIds = courses.map(c => c.id);

    if (courseIds.length === 0) {
      return res.json({
        success: true,
        students: [],
        studentCount: 0,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total: 0,
          totalPages: 0
        }
      });
    }

    // Get unique active students with their courses
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    
    // Create a map to track students and their courses
    const studentMap = new Map();
    
    // Get all enrollments for instructor's courses
    const enrollments = await enrollmentRepo
      .createQueryBuilder("enrollment")
      .leftJoinAndSelect("enrollment.user", "user")
      .leftJoinAndSelect("enrollment.course", "course")
      .where("enrollment.course_id IN (:...courseIds)", { courseIds })
      .andWhere("enrollment.status = :status", { status: EnrollmentStatus.ACTIVE })
      .andWhere("user.is_active = true")
      .getMany();

    // Group by student
    enrollments.forEach(enrollment => {
      const student = enrollment.user;
      const course = enrollment.course;
      
      if (!studentMap.has(student.id)) {
        studentMap.set(student.id, {
          student: {
            id: student.id,
            email: student.email,
            firstName: student.first_name,
            lastName: student.last_name,
            totalPoints: student.total_learning_hours || 0,
            level: Math.floor((student.total_learning_hours || 0) / 100) + 1,
            streakDays: 0,
            profilePicUrl: student.profile_picture_url,
            isActive: student.is_active,
            isEmailVerified: student.is_verified,
            createdAt: student.date_joined,
            updatedAt: student.updated_at
          },
          courses: []
        });
      }
      
      const studentData = studentMap.get(student.id);
      if (!studentData.courses.some((c: any) => c.id === course.id)) {
        studentData.courses.push({
          id: course.id,
          title: course.title,
          level: course.level,
          completion_percentage: enrollment.completion_percentage || 0
        });
      }
    });

    // Convert map to array and apply search filter
    let studentsArray = Array.from(studentMap.values());
    
    if (search) {
      const searchLower = search.toString().toLowerCase();
      studentsArray = studentsArray.filter(item =>
        item.student.firstName?.toLowerCase().includes(searchLower) ||
        item.student.lastName?.toLowerCase().includes(searchLower) ||
        item.student.email?.toLowerCase().includes(searchLower)
      );
    }

    // Apply pagination
    const totalCount = studentsArray.length;
    const paginatedStudents = studentsArray.slice(skip, skip + limitNumber);

    res.json({
      success: true,
      students: paginatedStudents,
      studentCount: totalCount,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNumber)
      }
    });

  } catch (error: any) {
    console.error("❌ Get my students error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch students",
      error: error.message
    });
  }
}

  // ==================== HELPER METHODS ====================

  private static async verifyCourseAccess(courseId: string, userId: string) {
    const courseRepo = dbConnection.getRepository(Course);
    const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);
    
    // Check if user is primary instructor
    const course = await courseRepo.findOne({
      where: { id: courseId, instructor_id: userId }
    });

    if (course) {
      return {
        access: true,
        isPrimary: true,
        permissions: {
          can_grade_assignments: true,
          can_manage_enrollments: true,
          can_edit_course_content: true
        }
      };
    }

    // Check if user is additional instructor
    const additionalInstructor = await courseInstructorRepo.findOne({
      where: {
        course_id: courseId,
        instructor_id: userId
      }
    });

    if (additionalInstructor) {
      return {
        access: true,
        isPrimary: false,
        permissions: {
          can_grade_assignments: additionalInstructor.can_grade_assignments,
          can_manage_enrollments: additionalInstructor.can_manage_enrollments,
          can_edit_course_content: additionalInstructor.can_edit_course_content
        }
      };
    }

    return { access: false };
  }

  private static async getCourseStatistics(courseId: string) {
    try {
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const progressRepo = dbConnection.getRepository(Progress);
      const moduleRepo = dbConnection.getRepository(Module);
      const lessonRepo = dbConnection.getRepository(Lesson);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const reviewRepo = dbConnection.getRepository(Review);

      // Enrollment statistics
      const enrollments = await enrollmentRepo.find({
        where: { course_id: courseId }
      });

      const enrollmentStats = {
        total: enrollments.length,
        active: enrollments.filter(e => e.status === EnrollmentStatus.ACTIVE).length,
        completed: enrollments.filter(e => e.status === EnrollmentStatus.COMPLETED).length,
        pending: enrollments.filter(e => e.status === EnrollmentStatus.PENDING).length
      };

      // Progress statistics
      const averageCompletion = enrollments.length > 0
        ? enrollments.reduce((sum, e) => sum + (e.completion_percentage || 0), 0) / enrollments.length
        : 0;

      const progressStats = {
        average_completion: averageCompletion,
        completed_students: enrollments.filter(e => e.completion_percentage === 100).length,
        in_progress_students: enrollments.filter(e => e.completion_percentage > 0 && e.completion_percentage < 100).length,
        not_started_students: enrollments.filter(e => e.completion_percentage === 0).length
      };

      // Content statistics
      const modulesCount = await moduleRepo.count({ where: { course_id: courseId } });
      const lessonsCount = await lessonRepo.count({ where: { course_id: courseId } });
      const assessmentsCount = await assessmentRepo.count({ where: { course_id: courseId } });

      // Get total duration
      const lessons = await lessonRepo.find({
        where: { course_id: courseId },
        select: ["duration_minutes"]
      });
      const totalDuration = lessons.reduce((sum, lesson) => sum + (lesson.duration_minutes || 0), 0);

      const contentStats = {
        modules_count: modulesCount,
        lessons_count: lessonsCount,
        assessments_count: assessmentsCount,
        total_duration_minutes: totalDuration
      };

      // Rating statistics
      const reviews = await reviewRepo.find({
        where: { course_id: courseId }
      });

      const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      reviews.forEach(review => {
        if (review.rating >= 1 && review.rating <= 5) {
          ratingDistribution[review.rating as keyof typeof ratingDistribution]++;
        }
      });

      const ratingStats = {
        average: reviews.length > 0
          ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
          : 0,
        total_reviews: reviews.length,
        distribution: ratingDistribution
      };

      // Recent activity
      const recentEnrollments = await enrollmentRepo.find({
        where: { course_id: courseId },
        order: { enrolled_at: "DESC" },
        take: 1
      });

      const recentActivity = {
        latest_enrollment: recentEnrollments[0]?.enrolled_at || null,
        latest_student_activity: null, // Would need activity tracking
        recent_submissions: 0 // Would need assessment submission tracking
      };

      return {
        enrollments: enrollmentStats,
        progress: progressStats,
        content: contentStats,
        ratings: ratingStats,
        recent_activity: recentActivity
      };

    } catch (error) {
      console.error("Error getting course statistics:", error);
      return null;
    }
  }

  private static async getCoursesSummary(userId: string, filters?: any) {
    const courseRepo = dbConnection.getRepository(Course);
    
    const queryBuilder = courseRepo
      .createQueryBuilder("course")
      .where(
        `(
          course.instructor_id = :userId 
          OR EXISTS (
            SELECT 1 FROM course_instructors ci 
            WHERE ci.course_id = course.id 
            AND ci.instructor_id = :userId 
            AND ci.can_edit_course_content = true
          )
        )`,
        { userId }
      );

    // Apply filters if provided
    if (filters?.status) {
      queryBuilder.andWhere("course.status = :status", { status: filters.status });
    }
    if (filters?.course_type) {
      queryBuilder.andWhere("course.course_type = :course_type", { course_type: filters.course_type });
    }
    if (filters?.institution_id) {
      queryBuilder.andWhere("course.institution_id = :institution_id", { institution_id: filters.institution_id });
    }
    if (filters?.search) {
      queryBuilder.andWhere(
        "(course.title ILIKE :search OR course.description ILIKE :search)",
        { search: `%${filters.search}%` }
      );
    }

    const courses = await queryBuilder.getMany();

    // Count primary vs additional instructor courses
    let primaryCount = 0;
    let additionalCount = 0;

    for (const course of courses) {
      if (course.instructor_id === userId) {
        primaryCount++;
      } else {
        additionalCount++;
      }
    }

    // Count by status
    const byStatus = {
      PUBLISHED: courses.filter(c => c.status === CourseStatus.PUBLISHED).length,
      DRAFT: courses.filter(c => c.status === CourseStatus.DRAFT).length,
      ARCHIVED: courses.filter(c => c.status === CourseStatus.ARCHIVED).length
    };

    // Count by type
    const byType = {
      MOOC: courses.filter(c => c.course_type === CourseType.MOOC).length,
      SPOC: courses.filter(c => c.course_type === CourseType.SPOC).length
    };

    return {
      total_courses: courses.length,
      primary_instructor_courses: primaryCount,
      additional_instructor_courses: additionalCount,
      by_status: byStatus,
      by_type: byType
    };
  }

  private static async getStudentStatistics(userId: string) {
    // Get all courses where user is instructor
    const courseRepo = dbConnection.getRepository(Course);
    const courses = await courseRepo
      .createQueryBuilder("course")
      .where(
        `(
          course.instructor_id = :userId 
          OR EXISTS (
            SELECT 1 FROM course_instructors ci 
            WHERE ci.course_id = course.id 
            AND ci.instructor_id = :userId 
            AND ci.can_edit_course_content = true
          )
        )`,
        { userId }
      )
      .getMany();

    const courseIds = courses.map(c => c.id);

    if (courseIds.length === 0) {
      return {
        total_students: 0,
        active_students: 0,
        completed_students: 0,
        average_completion_rate: 0
      };
    }

    // Get enrollment statistics
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    
    // Total unique students
    const totalStudents = await enrollmentRepo
      .createQueryBuilder("enrollment")
      .select("COUNT(DISTINCT enrollment.user_id)", "count")
      .where("enrollment.course_id IN (:...courseIds)", { courseIds })
      .andWhere("enrollment.status = :status", { status: EnrollmentStatus.ACTIVE })
      .getRawOne();

    // Active students (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const activeStudents = await enrollmentRepo
      .createQueryBuilder("enrollment")
      .select("COUNT(DISTINCT enrollment.user_id)", "count")
      .where("enrollment.course_id IN (:...courseIds)", { courseIds })
      .andWhere("enrollment.status = :status", { status: EnrollmentStatus.ACTIVE })
      .andWhere("enrollment.last_accessed >= :weekAgo", { weekAgo })
      .getRawOne();

    // Completed students
    const completedStudents = await enrollmentRepo
      .createQueryBuilder("enrollment")
      .select("COUNT(DISTINCT enrollment.user_id)", "count")
      .where("enrollment.course_id IN (:...courseIds)", { courseIds })
      .andWhere("enrollment.status = :status", { status: EnrollmentStatus.COMPLETED })
      .getRawOne();

    // Average completion rate
    const enrollments = await enrollmentRepo.find({
      where: {
        course_id: In(courseIds),
        status: EnrollmentStatus.ACTIVE
      }
    });

    const averageCompletion = enrollments.length > 0
      ? enrollments.reduce((sum, e) => sum + (e.completion_percentage || 0), 0) / enrollments.length
      : 0;

    return {
      total_students: parseInt(totalStudents?.count || "0"),
      active_students: parseInt(activeStudents?.count || "0"),
      completed_students: parseInt(completedStudents?.count || "0"),
      average_completion_rate: averageCompletion
    };
  }

  private static async getEngagementMetrics(courses: Course[]) {
    if (courses.length === 0) {
      return {
        average_course_rating: 0,
        total_reviews: 0,
        total_enrollments: 0,
        overall_completion_rate: 0,
        average_course_completion_time: 0
      };
    }

    const courseIds = courses.map(c => c.id);
    
    // Get all enrollments for these courses
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const enrollments = await enrollmentRepo.find({
      where: { course_id: In(courseIds) }
    });

    // Calculate metrics
    const totalEnrollments = enrollments.length;
    const completedEnrollments = enrollments.filter(e => e.status === EnrollmentStatus.COMPLETED).length;
    const overallCompletionRate = totalEnrollments > 0
      ? (completedEnrollments / totalEnrollments) * 100
      : 0;

    // Average course rating
    const averageRating = courses.length > 0
      ? courses.reduce((sum, course) => sum + parseFloat(course.average_rating?.toString() || "0"), 0) / courses.length
      : 0;

    // Total reviews
    const totalReviews = courses.reduce((sum, course) => sum + (course.total_reviews || 0), 0);

    return {
      average_course_rating: averageRating,
      total_reviews: totalReviews,
      total_enrollments: totalEnrollments,
      overall_completion_rate: overallCompletionRate,
      average_course_completion_time: 0 // Would need more data to calculate
    };
  }

  private static async getRecentActivity(userId: string) {
    // Get recent enrollments (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const recentEnrollments = await enrollmentRepo
      .createQueryBuilder("enrollment")
      .leftJoinAndSelect("enrollment.course", "course")
      .leftJoinAndSelect("enrollment.user", "user")
      .where(
        `course.id IN (
          SELECT c.id FROM courses c 
          WHERE c.instructor_id = :userId 
          OR EXISTS (
            SELECT 1 FROM course_instructors ci 
            WHERE ci.course_id = c.id 
            AND ci.instructor_id = :userId 
            AND ci.can_edit_course_content = true
          )
        )`,
        { userId }
      )
      .andWhere("enrollment.enrolled_at >= :weekAgo", { weekAgo })
      .orderBy("enrollment.enrolled_at", "DESC")
      .take(5)
      .getMany();

    // Format recent enrollments
    const formattedEnrollments = recentEnrollments.map(enrollment => ({
      student: {
        id: enrollment.user.id,
        name: `${enrollment.user.first_name} ${enrollment.user.last_name}`,
        email: enrollment.user.email,
        profile_picture_url: enrollment.user.profile_picture_url
      },
      course: {
        id: enrollment.course.id,
        title: enrollment.course.title
      },
      enrolled_at: enrollment.enrolled_at
    }));

    // Get recent lesson completions (would need activity tracking)
    const recentLessonCompletions = 0;
    const recentAssessmentSubmissions = 0;

    // Get latest activities (placeholder - would need activity tracking)
    const latestActivities = [];

    return {
      new_enrollments: recentEnrollments.length,
      recent_enrollments: formattedEnrollments,
      recent_lesson_completions: recentLessonCompletions,
      recent_assessment_submissions: recentAssessmentSubmissions,
      latest_activities: latestActivities
    };
  }

  private static async getContentStatistics(courses: Course[]) {
    const courseIds = courses.map(c => c.id);

    if (courseIds.length === 0) {
      return {
        total_modules: 0,
        total_lessons: 0,
        total_assessments: 0,
        total_duration_hours: 0
      };
    }

    // Get module count
    const moduleRepo = dbConnection.getRepository(Module);
    const totalModules = await moduleRepo.count({
      where: { course_id: In(courseIds) }
    });

    // Get lesson count
    const lessonRepo = dbConnection.getRepository(Lesson);
    const totalLessons = await lessonRepo.count({
      where: { course_id: In(courseIds) }
    });

    // Get assessment count
    const assessmentRepo = dbConnection.getRepository(Assessment);
    const totalAssessments = await assessmentRepo.count({
      where: { course_id: In(courseIds) }
    });

    // Calculate total duration
    const lessons = await lessonRepo.find({
      where: { course_id: In(courseIds) },
      select: ["duration_minutes"]
    });
    const totalDurationMinutes = lessons.reduce((sum, lesson) => sum + (lesson.duration_minutes || 0), 0);
    const totalDurationHours = totalDurationMinutes / 60;

    return {
      total_modules: totalModules,
      total_lessons: totalLessons,
      total_assessments: totalAssessments,
      total_duration_hours: totalDurationHours
    };
  }

  private static async getAttentionRequiredItems(userId: string, courses: Course[]) {
    const courseIds = courses.map(c => c.id);

    // Count draft courses
    const draftCourses = courses.filter(c => c.status === CourseStatus.DRAFT).length;

    // Count pending enrollment approvals (for SPOC courses)
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const pendingApprovals = courseIds.length > 0
      ? await enrollmentRepo.count({
          where: {
            course_id: In(courseIds),
            status: EnrollmentStatus.PENDING
          }
        })
      : 0;

    // Count ungraded assignments (placeholder)
    const pendingAssignments = 0;

    // Count low-rated courses
    const lowRatedCourses = courses.filter(c => {
      const rating = parseFloat(c.average_rating?.toString() || "0");
      return rating > 0 && rating < 3.0;
    }).length;

    // Count inactive courses (no activity in 30+ days)
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const inactiveCourses = 0; // Would need activity tracking

    return {
      pending_assignments: pendingAssignments,
      draft_courses: draftCourses,
      pending_approvals: pendingApprovals,
      low_rated_courses: lowRatedCourses,
      inactive_courses: inactiveCourses,
      total_items: pendingAssignments + draftCourses + pendingApprovals + lowRatedCourses + inactiveCourses
    };
  }

  private static async getTopPerformingCourses(courses: Course[]) {
    // Sort by enrollment count
    const byEnrollment = [...courses]
      .sort((a, b) => (b.enrollment_count || 0) - (a.enrollment_count || 0))
      .slice(0, 3)
      .map(course => ({
        id: course.id,
        title: course.title,
        enrollment_count: course.enrollment_count || 0,
        thumbnail_url: course.thumbnail_url
      }));

    // Sort by rating
    const byRating = [...courses]
      .filter(c => parseFloat(c.average_rating?.toString() || "0") > 0)
      .sort((a, b) => parseFloat(b.average_rating?.toString() || "0") - parseFloat(a.average_rating?.toString() || "0"))
      .slice(0, 3)
      .map(course => ({
        id: course.id,
        title: course.title,
        average_rating: parseFloat(course.average_rating?.toString() || "0"),
        total_reviews: course.total_reviews || 0,
        thumbnail_url: course.thumbnail_url
      }));

    // Sort by completion rate
    const byCompletion = [...courses]
      .sort((a, b) => (b.completion_rate || 0) - (a.completion_rate || 0))
      .slice(0, 3)
      .map(course => ({
        id: course.id,
        title: course.title,
        completion_rate: course.completion_rate || 0,
        thumbnail_url: course.thumbnail_url
      }));

    return {
      by_enrollment: byEnrollment,
      by_rating: byRating,
      by_completion: byCompletion
    };
  }

  private static async getInstitutionSummary(userId: string) {
    // Get all institutions where user is instructor
    const courseRepo = dbConnection.getRepository(Course);
    const courses = await courseRepo
      .createQueryBuilder("course")
      .leftJoinAndSelect("course.institution", "institution")
      .where(
        `(
          course.instructor_id = :userId 
          OR EXISTS (
            SELECT 1 FROM course_instructors ci 
            WHERE ci.course_id = course.id 
            AND ci.instructor_id = :userId 
            AND ci.can_edit_course_content = true
          )
        )`,
        { userId }
      )
      .andWhere("course.institution_id IS NOT NULL")
      .getMany();

    // Group by institution
    const institutionMap = new Map();
    
    courses.forEach(course => {
      if (course.institution) {
        const institutionId = course.institution.id;
        if (!institutionMap.has(institutionId)) {
          institutionMap.set(institutionId, {
            institution: course.institution,
            courses: [],
            studentCount: 0
          });
        }
        institutionMap.get(institutionId).courses.push(course);
      }
    });

    // Calculate student counts for each institution
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    
    const institutions = await Promise.all(
      Array.from(institutionMap.values()).map(async (data) => {
        const courseIds = data.courses.map((c: Course) => c.id);
        
        const studentCount = courseIds.length > 0
          ? await enrollmentRepo
              .createQueryBuilder("enrollment")
              .select("COUNT(DISTINCT enrollment.user_id)", "count")
              .where("enrollment.course_id IN (:...courseIds)", { courseIds })
              .andWhere("enrollment.status = :status", { status: EnrollmentStatus.ACTIVE })
              .getRawOne()
          : { count: "0" };

        return {
          id: data.institution.id,
          name: data.institution.name,
          logo_url: data.institution.logo_url,
          courses_count: data.courses.length,
          students_count: parseInt(studentCount?.count || "0")
        };
      })
    );

    return institutions;
  }

  private static getQuickActions(attentionRequired: any) {
    const actions = [];

    if (attentionRequired.pending_assignments > 0) {
      actions.push({
        type: "grade_assignments",
        label: `Grade ${attentionRequired.pending_assignments} pending assignments`,
        count: attentionRequired.pending_assignments,
        link: "/dashboard/instructor/assignments/pending",
        priority: "high"
      });
    }

    if (attentionRequired.pending_approvals > 0) {
      actions.push({
        type: "approve_enrollments",
        label: `Approve ${attentionRequired.pending_approvals} enrollment requests`,
        count: attentionRequired.pending_approvals,
        link: "/dashboard/instructor/enrollments/pending",
        priority: "medium"
      });
    }

    if (attentionRequired.draft_courses > 0) {
      actions.push({
        type: "publish_courses",
        label: `Publish ${attentionRequired.draft_courses} draft courses`,
        count: attentionRequired.draft_courses,
        link: "/dashboard/instructor/courses?status=DRAFT",
        priority: "low"
      });
    }

    return actions;
  }

  private static async getStudentProgressDetails(courseId: string, studentId: string, course: Course) {
    try {
      // Get lesson progress - FIXED: Query using lesson_id from course's lessons
      const lessonProgressRepo = dbConnection.getRepository(LessonProgress);
      
      // Get all lesson IDs for this course
      const lessonIds = course.lessons?.map(l => l.id) || [];
      
      // Count completed lessons for this student
      const completedLessons = lessonIds.length > 0
        ? await lessonProgressRepo.count({
            where: {
              user_id: studentId,
              lesson_id: In(lessonIds),
              is_completed: true
            }
          })
        : 0;

      // Get module progress
      const moduleRepo = dbConnection.getRepository(Module);
      const modules = await moduleRepo.find({
        where: { course_id: courseId },
        relations: ["lessons"],
        order: { order_index: "ASC" }
      });

      let modulesCompleted = 0;
      let currentModule = null;

      for (const module of modules) {
        const moduleLessons = module.lessons || [];
        const moduleLessonIds = moduleLessons.map(l => l.id);
        
        const completedModuleLessons = moduleLessonIds.length > 0
          ? await lessonProgressRepo.count({
              where: {
                user_id: studentId,
                lesson_id: In(moduleLessonIds),
                is_completed: true
              }
            })
          : 0;

        if (completedModuleLessons === moduleLessons.length && moduleLessons.length > 0) {
          modulesCompleted++;
        } else if (!currentModule && moduleLessons.length > 0) {
          currentModule = {
            id: module.id,
            title: module.title,
            order_index: module.order_index
          };
        }
      }

      // Time metrics (placeholder)
      const timeMetrics = {
        total_time_spent_minutes: 0,
        average_session_duration_minutes: 0,
        total_sessions: 0,
        estimated_completion_date: null,
        on_track: true
      };

      // Recent activity (placeholder)
      const recentActivity = [];

      // Current position
      const currentPosition = {
        module_title: currentModule?.title || "Not started",
        lesson_title: "Not started",
        last_watched_video_progress: 0
      };

      return {
        time_metrics: timeMetrics,
        recent_activity: recentActivity,
        current_position: currentPosition,
        lessons_completed: completedLessons,
        modules_completed: modulesCompleted,
        current_module: currentModule
      };

    } catch (error) {
      console.error("Error getting student progress details:", error);
      return null;
    }
  }

  private static async checkStudentAtRisk(enrollment: Enrollment, details: any) {
    // Check if student hasn't been active in 7+ days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    if (enrollment.last_accessed && new Date(enrollment.last_accessed) < weekAgo) {
      return true;
    }

    // Check if low completion after 2+ weeks
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    if (enrollment.enrolled_at && new Date(enrollment.enrolled_at) < twoWeeksAgo) {
      if (enrollment.completion_percentage < 20) {
        return true;
      }
    }

    return false;
  }

  private static async getStudentsStatistics(courseId: string, filters?: any) {
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    
    const queryBuilder = enrollmentRepo
      .createQueryBuilder("enrollment")
      .where("enrollment.course_id = :courseId", { courseId })
      .andWhere("enrollment.status != :dropped", { dropped: "DROPPED" });

    // Apply filters if provided
    if (filters?.status) {
      queryBuilder.andWhere("enrollment.status = :status", { status: filters.status });
    }

    if (filters?.progress_filter) {
      switch (filters.progress_filter) {
        case "not_started":
          queryBuilder.andWhere("enrollment.completion_percentage = 0");
          break;
        case "in_progress":
          queryBuilder.andWhere("enrollment.completion_percentage > 0 AND enrollment.completion_percentage < 100");
          break;
        case "completed":
          queryBuilder.andWhere("enrollment.completion_percentage = 100");
          break;
      }
    }

    const enrollments = await queryBuilder.getMany();

    // Calculate statistics
    const totalStudents = enrollments.length;
    
    const byStatus = {
      ACTIVE: enrollments.filter(e => e.status === EnrollmentStatus.ACTIVE).length,
      COMPLETED: enrollments.filter(e => e.status === EnrollmentStatus.COMPLETED).length,
      DROPPED: enrollments.filter(e => e.status === "DROPPED").length,
      PENDING: enrollments.filter(e => e.status === EnrollmentStatus.PENDING).length
    };

    const byProgress = {
      not_started: enrollments.filter(e => e.completion_percentage === 0).length,
      in_progress: enrollments.filter(e => e.completion_percentage > 0 && e.completion_percentage < 100).length,
      completed: enrollments.filter(e => e.completion_percentage === 100).length
    };

    const averageCompletion = totalStudents > 0
      ? enrollments.reduce((sum, e) => sum + (e.completion_percentage || 0), 0) / totalStudents
      : 0;

    // Calculate at-risk students (simplified)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const atRiskStudents = enrollments.filter(e => {
      if (!e.last_accessed) return false;
      return new Date(e.last_accessed) < weekAgo && e.completion_percentage < 50;
    }).length;

    const topPerformers = enrollments.filter(e => e.completion_percentage >= 80).length;

    return {
      total_students: totalStudents,
      by_status: byStatus,
      by_progress: byProgress,
      average_completion: averageCompletion,
      average_time_spent_hours: 0, // Would need time tracking
      at_risk_students: atRiskStudents,
      top_performers: topPerformers
    };
  }
}