// @ts-nocheck

import { Request, Response } from "express";
import { randomBytes } from "crypto";
import { In } from "typeorm";
import { format } from "date-fns";
import dbConnection from "../database/db";
import { Course, CourseType } from "../database/models/Course";
import { BwengeRole, User } from "../database/models/User";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { sendEmail } from "../services/emailService";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { Institution } from "../database/models/Institution";
import { AccessCodeRequest, AccessCodeRequestStatus } from "../database/models/AccessCodeRequest";
import { Enrollment, EnrollmentStatus, EnrollmentApprovalStatus, EnrollmentRequestType } from "../database/models/Enrollment";
import { NotificationService } from "../services/notificationService";
import { emitToUser, emitToInstitutionAdmins, emitToAdminRoom, emitToCourse } from "../socket/socketEmitter";

export class EnhancedEnrollmentController {
  
  
  static async getInstructorEnrollmentAnalytics(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { start_date, end_date, course_id } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
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

      let courseIds = courses.map(c => c.id);

      // Filter by specific course if provided
      if (course_id && course_id !== "all") {
        if (courseIds.includes(course_id as string)) {
          courseIds = [course_id as string];
        } else {
          return res.status(403).json({
            success: false,
            message: "You don't have access to this course",
          });
        }
      }

      if (courseIds.length === 0) {
        return res.json({
          success: true,
          data: {
            summary: {
              total_enrollments: 0,
              active_enrollments: 0,
              completed_enrollments: 0,
              dropped_enrollments: 0,
              pending_enrollments: 0,
              conversion_rate: 0,
              average_completion_time: 0,
              total_students: 0,
              students_with_multiple_enrollments: 0,
              active_last_30_days: 0,
              average_progress: 0,
            },
            enrollment_growth: {
              daily: 0,
              weekly: 0,
              monthly: 0,
              yearly: 0,
            },
            by_course: [],
            by_month: [],
            by_status: [],
            by_course_type: [],
            top_courses: [],
            by_country: [],
            filters_applied: {
              start_date: start_date || null,
              end_date: end_date || null,
              course_id: course_id || null,
            },
          },
        });
      }

      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const userRepo = dbConnection.getRepository(User);

      // Build base query
      let queryBuilder = enrollmentRepo
        .createQueryBuilder("enrollment")
        .leftJoinAndSelect("enrollment.user", "user")
        .leftJoinAndSelect("enrollment.course", "course")
        .where("enrollment.course_id IN (:...courseIds)", { courseIds });

      // Apply date filters
      if (start_date) {
        queryBuilder.andWhere("enrollment.enrolled_at >= :start_date", { 
          start_date: new Date(start_date as string) 
        });
      }
      if (end_date) {
        queryBuilder.andWhere("enrollment.enrolled_at <= :end_date", { 
          end_date: new Date(end_date as string) 
        });
      }

      const enrollments = await queryBuilder.getMany();

      // ==================== BASIC STATISTICS ====================
      const total_enrollments = enrollments.length;
      const active_enrollments = enrollments.filter(e => e.status === "ACTIVE").length;
      const completed_enrollments = enrollments.filter(e => e.status === "COMPLETED").length;
      const dropped_enrollments = enrollments.filter(e => e.status === "DROPPED").length;
      const pending_enrollments = enrollments.filter(e => e.status === "PENDING").length;

      // Calculate conversion rate (pending → active)
      const total_requests = enrollments.filter(e => 
        e.request_type === "APPROVAL_REQUEST" || e.request_type === "ACCESS_CODE_REQUEST"
      ).length;
      const approved_requests = enrollments.filter(e => 
        e.approval_status === "APPROVED" && e.status === "ACTIVE"
      ).length;
      const conversion_rate = total_requests > 0 ? approved_requests / total_requests : 0;

      // Calculate average completion time (in days)
      const completedEnrollments = enrollments.filter(e => 
        e.status === "COMPLETED" && e.completion_date && e.enrolled_at
      );
      const completionTimes = completedEnrollments.map(e => {
        const diffTime = Math.abs(e.completion_date!.getTime() - e.enrolled_at.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // days
      });
      const average_completion_time = completionTimes.length > 0
        ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
        : 0;

      // Get total unique students
      const uniqueStudentIds = [...new Set(enrollments.map(e => e.user_id))];
      const total_students = uniqueStudentIds.length;

      // Students with multiple enrollments
      const studentEnrollmentCounts = new Map();
      enrollments.forEach(e => {
        const count = studentEnrollmentCounts.get(e.user_id) || 0;
        studentEnrollmentCounts.set(e.user_id, count + 1);
      });
      const students_with_multiple_enrollments = Array.from(studentEnrollmentCounts.values())
        .filter(count => count > 1).length;

      // ==================== GROUP BY COURSE ====================
      const courseMap = new Map();
      for (const enrollment of enrollments) {
        const courseId = enrollment.course_id;
        if (!courseMap.has(courseId)) {
          const course = courses.find(c => c.id === courseId);
          courseMap.set(courseId, {
            course_id: courseId,
            course_title: course?.title || "Unknown",
            course_type: course?.course_type || "UNKNOWN",
            enrollment_count: 0,
            active_count: 0,
            completed_count: 0,
            pending_count: 0,
            dropped_count: 0,
            progress_sum: 0,
            progress_count: 0,
          });
        }
        
        const courseData = courseMap.get(courseId);
        courseData.enrollment_count++;
        
        if (enrollment.status === "ACTIVE") {
          courseData.active_count++;
        } else if (enrollment.status === "COMPLETED") {
          courseData.completed_count++;
        } else if (enrollment.status === "PENDING") {
          courseData.pending_count++;
        } else if (enrollment.status === "DROPPED") {
          courseData.dropped_count++;
        }
        
        courseData.progress_sum += enrollment.progress_percentage || 0;
        courseData.progress_count++;
      }

      const by_course = Array.from(courseMap.values()).map(course => ({
        ...course,
        completion_rate: course.enrollment_count > 0 
          ? course.completed_count / course.enrollment_count 
          : 0,
        active_rate: course.enrollment_count > 0
          ? course.active_count / course.enrollment_count
          : 0,
        average_progress: course.progress_count > 0 
          ? course.progress_sum / course.progress_count 
          : 0,
      }));

      // ==================== GROUP BY MONTH ====================
      const monthMap = new Map();
      enrollments.forEach(e => {
        const month = format(e.enrolled_at, "yyyy-MM");
        if (!monthMap.has(month)) {
          monthMap.set(month, { 
            month, 
            enrollments: 0, 
            completions: 0,
            active: 0,
            pending: 0 
          });
        }
        const monthData = monthMap.get(month);
        monthData.enrollments++;
        
        if (e.status === "ACTIVE") {
          monthData.active++;
        } else if (e.status === "PENDING") {
          monthData.pending++;
        }
        
        if (e.status === "COMPLETED" && e.completion_date) {
          const completionMonth = format(e.completion_date, "yyyy-MM");
          if (!monthMap.has(completionMonth)) {
            monthMap.set(completionMonth, { 
              month: completionMonth, 
              enrollments: 0, 
              completions: 0,
              active: 0,
              pending: 0 
            });
          }
          monthMap.get(completionMonth).completions++;
        }
      });

      const by_month = Array.from(monthMap.entries())
        .map(([month, counts]) => ({
          month,
          enrollments: counts.enrollments,
          completions: counts.completions,
          active: counts.active,
          pending: counts.pending,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      // ==================== GROUP BY STATUS ====================
      const statusCounts = {
        ACTIVE: active_enrollments,
        COMPLETED: completed_enrollments,
        DROPPED: dropped_enrollments,
        PENDING: pending_enrollments,
      };
      
      const by_status = Object.entries(statusCounts)
        .filter(([_, count]) => count > 0)
        .map(([status, count]) => ({ status, count }));

      // ==================== GROUP BY COURSE TYPE ====================
      const typeCounts = {
        MOOC: enrollments.filter(e => e.course?.course_type === "MOOC").length,
        SPOC: enrollments.filter(e => e.course?.course_type === "SPOC").length,
      };
      
      const by_course_type = Object.entries(typeCounts)
        .filter(([_, count]) => count > 0)
        .map(([type, count]) => ({ type, count }));

      // ==================== TOP COURSES ====================
      const top_courses = by_course
        .sort((a, b) => b.enrollment_count - a.enrollment_count)
        .slice(0, 5)
        .map(c => ({
          course_id: c.course_id,
          course_title: c.course_title,
          enrollment_count: c.enrollment_count,
          active_count: c.active_count,
          completed_count: c.completed_count,
        }));

      // ==================== CALCULATE GROWTH RATES ====================
      const enrollment_growth = EnhancedEnrollmentController.calculateGrowthRates(by_month);

      // ==================== GET STUDENT DEMOGRAPHICS ====================
      const studentRepo = dbConnection.getRepository(User);
      const students = await studentRepo.find({
        where: { id: In(uniqueStudentIds) },
      });

      const countryCounts = new Map();
      students.forEach(student => {
        if (student.country) {
          const count = countryCounts.get(student.country) || 0;
          countryCounts.set(student.country, count + 1);
        }
      });

      const by_country = Array.from(countryCounts.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // ==================== CALCULATE ENGAGEMENT METRICS ====================
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const active_last_30_days = enrollments.filter(e => 
        e.last_accessed && e.last_accessed >= thirtyDaysAgo
      ).length;

      const average_progress = enrollments.length > 0
        ? enrollments.reduce((sum, e) => sum + (e.progress_percentage || 0), 0) / enrollments.length
        : 0;

      // ==================== FINAL RESPONSE ====================
      res.json({
        success: true,
        data: {
          summary: {
            total_enrollments,
            active_enrollments,
            completed_enrollments,
            dropped_enrollments,
            pending_enrollments,
            conversion_rate,
            average_completion_time,
            total_students,
            students_with_multiple_enrollments,
            active_last_30_days,
            average_progress,
          },
          enrollment_growth,
          by_course,
          by_month,
          by_status,
          by_course_type,
          top_courses,
          by_country,
          filters_applied: {
            start_date: start_date || null,
            end_date: end_date || null,
            course_id: course_id || null,
          },
        },
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch enrollment analytics",
        error: error.message,
      });
    }
  }

  // ==================== HELPER: CALCULATE GROWTH RATES ====================
  private static calculateGrowthRates(monthlyData: any[]): { daily: number; weekly: number; monthly: number; yearly: number } {
    if (monthlyData.length < 2) {
      return { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    }

    // Sort by month
    const sorted = [...monthlyData].sort((a, b) => a.month.localeCompare(b.month));
    
    // Get the last month's data
    const recent = sorted.slice(-1)[0]?.enrollments || 0;
    const previous = sorted.slice(-2, -1)[0]?.enrollments || 0;
    
    // Calculate month-over-month growth
    const monthlyGrowth = previous > 0 ? (recent - previous) / previous : recent > 0 ? 1 : 0;

    // Calculate 3-month trend
    const threeMonthAvg = sorted.slice(-3).reduce((sum, m) => sum + m.enrollments, 0) / 3;
    const sixMonthAvg = sorted.slice(-6, -3).reduce((sum, m) => sum + m.enrollments, 0) / 3;
    const yearlyGrowth = sixMonthAvg > 0 ? (threeMonthAvg - sixMonthAvg) / sixMonthAvg : threeMonthAvg > 0 ? 1 : 0;

    return {
      daily: monthlyGrowth / 30, // Approximate daily from monthly
      weekly: monthlyGrowth / 4,  // Approximate weekly from monthly
      monthly: monthlyGrowth,
      yearly: yearlyGrowth * 4,   // Approximate yearly from 3-month trend
    };
  }

  // ==================== EXPORT ENROLLMENT ANALYTICS ====================
  static async exportInstructorEnrollmentAnalytics(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { start_date, end_date, course_id, format = 'csv' } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
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

      let courseIds = courses.map(c => c.id);

      // Filter by specific course if provided
      if (course_id && course_id !== "all") {
        if (courseIds.includes(course_id as string)) {
          courseIds = [course_id as string];
        }
      }

      if (courseIds.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No courses found",
        });
      }

      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      // Build query
      let queryBuilder = enrollmentRepo
        .createQueryBuilder("enrollment")
        .leftJoinAndSelect("enrollment.user", "user")
        .leftJoinAndSelect("enrollment.course", "course")
        .where("enrollment.course_id IN (:...courseIds)", { courseIds });

      // Apply date filters
      if (start_date) {
        queryBuilder.andWhere("enrollment.enrolled_at >= :start_date", { 
          start_date: new Date(start_date as string) 
        });
      }
      if (end_date) {
        queryBuilder.andWhere("enrollment.enrolled_at <= :end_date", { 
          end_date: new Date(end_date as string) 
        });
      }

      const enrollments = await queryBuilder
        .orderBy("enrollment.enrolled_at", "DESC")
        .getMany();

      if (format === 'csv') {
        const headers = [
          'Enrollment ID',
          'Student ID',
          'Student Email',
          'Student Name',
          'Course ID',
          'Course Title',
          'Course Type',
          'Enrolled Date',
          'Status',
          'Approval Status',
          'Progress %',
          'Completed Lessons',
          'Total Time (min)',
          'Completion Date',
          'Certificate Issued',
          'Final Score',
          'Last Accessed',
        ];

        const rows = enrollments.map(e => [
          e.id,
          e.user.id,
          e.user.email,
          `${e.user.first_name || ''} ${e.user.last_name || ''}`.trim(),
          e.course.id,
          e.course.title,
          e.course.course_type,
          format(e.enrolled_at, 'yyyy-MM-dd'),
          e.status,
          e.approval_status || '',
          e.progress_percentage || 0,
          e.completed_lessons || 0,
          e.total_time_spent_minutes || 0,
          e.completion_date ? format(e.completion_date, 'yyyy-MM-dd') : '',
          e.certificate_issued ? 'Yes' : 'No',
          e.final_score || '',
          e.last_accessed ? format(e.last_accessed, 'yyyy-MM-dd') : '',
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=enrollment_analytics_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        return res.send(csvContent);
      }

      res.json({
        success: true,
        data: enrollments,
        total: enrollments.length,
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to export enrollment analytics",
        error: error.message,
      });
    }
  }

// Add to EnhancedCourseController class

// Generate access codes for public SPOC courses (System Admin)
static async generatePublicCourseAccessCodes(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { count, expiry_date, usage_limit } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!count || count < 1) {
      return res.status(400).json({
        success: false,
        message: "Valid count is required",
      });
    }

    const courseRepo = dbConnection.getRepository(Course);
    const userRepo = dbConnection.getRepository(User);

    const course = await courseRepo.findOne({ 
      where: { id },
      relations: ["instructor"]
    });
    
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    // Only SPOC courses can have access codes
    if (course.course_type !== CourseType.SPOC) {
      return res.status(400).json({
        success: false,
        message: "Access codes can only be generated for SPOC courses",
      });
    }

    // Check if course is public
    if (!course.is_public) {
      return res.status(400).json({
        success: false,
        message: "This course is not a public course. Access codes can only be generated for public SPOC courses.",
      });
    }

    // ==================== PERMISSION CHECK ====================
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    // Only SYSTEM_ADMIN can generate access codes for public SPOC courses
    if (user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: "Only System Administrators can generate access codes for public courses"
      });
    }

    // Generate unique codes
    const generateUniqueCode = (): string => {
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      return code;
    };

    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      let code = generateUniqueCode();
      // Ensure code is unique within the course
      while (course.access_codes && course.access_codes.includes(code)) {
        code = generateUniqueCode();
      }
      codes.push(code);
    }

    if (!course.access_codes) course.access_codes = [];
    course.access_codes = [...course.access_codes, ...codes];
    await courseRepo.save(course);

    // Send notification to course instructor (optional)
    if (course.instructor && course.instructor.email) {
      await sendEmail({
        to: course.instructor.email,
        subject: `Access Codes Generated for ${course.title}`,
        html: `
          <h2>Access Codes Generated</h2>
          <p>${count} access code(s) have been generated for your public SPOC course: <strong>${course.title}</strong></p>
          <p>The codes have been added to the course's available access codes pool.</p>
          <p>Students can now enroll using these codes.</p>
          <p><strong>Generated Codes:</strong></p>
          <ul>
            ${codes.map(code => `<li><code style="background: #f0f0f0; padding: 2px 6px; border-radius: 4px;">${code}</code></li>`).join('')}
          </ul>
        `,
      });
    }

    res.json({
      success: true,
      message: `${count} access codes generated successfully for ${course.title}`,
      data: {
        codes,
        expiry_date,
        usage_limit,
        course_id: course.id,
        course_title: course.title,
        total_codes_available: course.access_codes.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to generate access codes",
      error: error.message,
    });
  }
}

// Get access codes for a public course
static async getPublicCourseAccessCodes(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id;

    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    
    if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: "Access denied. System admin privileges required.",
      });
    }

    const courseRepo = dbConnection.getRepository(Course);
    const course = await courseRepo.findOne({ 
      where: { id },
      select: ["id", "title", "course_type", "is_public", "access_codes"]
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    if (course.course_type !== CourseType.SPOC) {
      return res.status(400).json({
        success: false,
        message: "Only SPOC courses have access codes",
      });
    }

    res.json({
      success: true,
      data: {
        course_id: course.id,
        course_title: course.title,
        course_type: course.course_type,
        is_public: course.is_public,
        access_codes: course.access_codes || [],
        total_codes: (course.access_codes || []).length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch access codes",
      error: error.message,
    });
  }
}
  static async getPublicCourseEnrollmentRequests(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { page = 1, limit = 20, status = "all", course_id, search } = req.query;
  
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }
  
      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId } });
      
      // Only SYSTEM_ADMIN can access this endpoint
      if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({
          success: false,
          message: "Access denied. System admin privileges required.",
        });
      }
  
      const skip = (Number(page) - 1) * Number(limit);
      
      // Get all public courses (is_public = true)
      const courseRepo = dbConnection.getRepository(Course);
      const courseQueryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.course_category", "course_category")
        .where("course.is_public = :is_public", { is_public: true });
  
      if (course_id && course_id !== "all") {
        courseQueryBuilder.andWhere("course.id = :course_id", { course_id });
      }
  
      if (search) {
        courseQueryBuilder.andWhere(
          "(course.title ILIKE :search OR course.description ILIKE :search)",
          { search: `%${search}%` }
        );
      }
  
      const courses = await courseQueryBuilder
        .orderBy("course.created_at", "DESC")
        .getMany();
  
      const courseIds = courses.map(c => c.id);
  
      if (courseIds.length === 0) {
        return res.json({
          success: true,
          data: {
            courses: [],
            enrollments: [],
            summary: {
              total_courses: 0,
              total_enrollments: 0,
              pending_approvals: 0,
              active_enrollments: 0,
              completed_enrollments: 0,
            },
            pagination: {
              page: Number(page),
              limit: Number(limit),
              total: 0,
              totalPages: 0,
            },
          },
        });
      }
  
      // Get enrollment requests for public courses
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const enrollmentQueryBuilder = enrollmentRepo
        .createQueryBuilder("enrollment")
        .leftJoinAndSelect("enrollment.user", "user")
        .leftJoinAndSelect("enrollment.course", "course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .where("enrollment.course_id IN (:...courseIds)", { courseIds });
  
      // Apply status filter
      if (status === "PENDING") {
        enrollmentQueryBuilder.andWhere("enrollment.status = :status", { status: "PENDING" });
        enrollmentQueryBuilder.andWhere("enrollment.approval_status = :approvalStatus", { approvalStatus: "PENDING" });
      } else if (status === "ACTIVE") {
        enrollmentQueryBuilder.andWhere("enrollment.status = :status", { status: "ACTIVE" });
      } else if (status === "COMPLETED") {
        enrollmentQueryBuilder.andWhere("enrollment.status = :status", { status: "COMPLETED" });
      } else if (status === "REJECTED") {
        enrollmentQueryBuilder.andWhere("enrollment.approval_status = :approvalStatus", { approvalStatus: "REJECTED" });
      }
  
      const [enrollments, total] = await enrollmentQueryBuilder
        .orderBy("enrollment.enrolled_at", "DESC")
        .skip(skip)
        .take(Number(limit))
        .getManyAndCount();
  
      // Get summary statistics
      const allEnrollments = await enrollmentRepo.find({
        where: { course_id: In(courseIds) },
      });
  
      const summary = {
        total_courses: courses.length,
        total_enrollments: allEnrollments.length,
        pending_approvals: allEnrollments.filter(e => e.status === "PENDING" && e.approval_status === "PENDING").length,
        active_enrollments: allEnrollments.filter(e => e.status === "ACTIVE").length,
        completed_enrollments: allEnrollments.filter(e => e.status === "COMPLETED").length,
      };
  
      // Transform enrollments
      const transformedEnrollments = enrollments.map(enrollment => ({
        id: enrollment.id,
        user: {
          id: enrollment.user.id,
          email: enrollment.user.email,
          first_name: enrollment.user.first_name,
          last_name: enrollment.user.last_name,
          profile_picture_url: enrollment.user.profile_picture_url,
        },
        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          description: enrollment.course.description,
          thumbnail_url: enrollment.course.thumbnail_url,
          course_type: enrollment.course.course_type,
          level: enrollment.course.level,
          instructor: enrollment.course.instructor ? {
            id: enrollment.course.instructor.id,
            first_name: enrollment.course.instructor.first_name,
            last_name: enrollment.course.instructor.last_name,
            email: enrollment.course.instructor.email,
          } : null,
        },
        enrolled_at: enrollment.enrolled_at,
        status: enrollment.status,
        approval_status: enrollment.approval_status,
        request_type: enrollment.request_type,
        request_message: enrollment.request_message,
        progress_percentage: enrollment.progress_percentage,
        completed_lessons: enrollment.completed_lessons,
        total_time_spent_minutes: enrollment.total_time_spent_minutes,
      }));
  
      // Transform courses with enrollment counts
      const transformedCourses = courses.map(course => {
        const courseEnrollments = allEnrollments.filter(e => e.course_id === course.id);
        return {
          id: course.id,
          title: course.title,
          description: course.description,
          thumbnail_url: course.thumbnail_url,
          course_type: course.course_type,
          level: course.level,
          status: course.status,
          is_public: course.is_public,
          instructor: course.instructor ? {
            id: course.instructor.id,
            first_name: course.instructor.first_name,
            last_name: course.instructor.last_name,
            email: course.instructor.email,
          } : null,
          category: course.course_category ? {
            id: course.course_category.id,
            name: course.course_category.name,
          } : null,
          enrollment_stats: {
            total: courseEnrollments.length,
            pending: courseEnrollments.filter(e => e.status === "PENDING").length,
            active: courseEnrollments.filter(e => e.status === "ACTIVE").length,
            completed: courseEnrollments.filter(e => e.status === "COMPLETED").length,
          },
          created_at: course.created_at,
          published_at: course.published_at,
        };
      });
  
      res.json({
        success: true,
        data: {
          courses: transformedCourses,
          enrollments: transformedEnrollments,
          summary,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
  
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch public course enrollment requests",
        error: error.message,
      });
    }
  }
  

static async sendPublicCourseAccessCode(req: Request, res: Response) {
  try {
    const { enrollment_request_id } = req.body;
    const adminId = req.user?.userId || req.user?.id;

    if (!enrollment_request_id) {
      return res.status(400).json({
        success: false,
        message: "Enrollment request ID is required",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const courseRepo = dbConnection.getRepository(Course);
    const userRepo = dbConnection.getRepository(User);
    const accessCodeRequestRepo = dbConnection.getRepository(AccessCodeRequest);

    // Get the enrollment request
    const enrollmentRequest = await enrollmentRepo.findOne({
      where: { id: enrollment_request_id },
      relations: ["user", "course"],
    });

    if (!enrollmentRequest) {
      return res.status(404).json({
        success: false,
        message: "Enrollment request not found",
      });
    }

    const course = enrollmentRequest.course;
    const user = enrollmentRequest.user;

    // Verify this is a public SPOC course
    if (course.course_type !== CourseType.SPOC) {
      return res.status(400).json({
        success: false,
        message: "Access codes can only be generated for SPOC courses",
      });
    }

    if (!course.is_public) {
      return res.status(400).json({
        success: false,
        message: "This course is not a public course",
      });
    }

    // Verify admin has permission (System Admin only)
    const admin = await userRepo.findOne({ where: { id: adminId } });
    if (!admin || admin.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      return res.status(403).json({
        success: false,
        message: "Only System Administrators can send access codes for public courses",
      });
    }

    // Generate a unique access code
    const generateUniqueCode = (): string => {
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      return code;
    };

    let accessCode = generateUniqueCode();
    
    // Ensure code is unique in the course
    const isCodeUsed = async (code: string): Promise<boolean> => {
      if (course.access_codes && course.access_codes.includes(code)) {
        return true;
      }
      const usedEnrollment = await enrollmentRepo.findOne({
        where: { access_code_used: code },
      });
      return !!usedEnrollment;
    };

    while (await isCodeUsed(accessCode)) {
      accessCode = generateUniqueCode();
    }

    // Add code to course's available access codes
    if (!course.access_codes) {
      course.access_codes = [];
    }
    course.access_codes.push(accessCode);
    await courseRepo.save(course);

    // Update enrollment request - mark as sent
    enrollmentRequest.access_code_sent = true;
    enrollmentRequest.access_code_sent_at = new Date();
    enrollmentRequest.approved_by_user_id = adminId;
    enrollmentRequest.approval_date = new Date();
    await enrollmentRepo.save(enrollmentRequest);

    // Create or update access code request record
    const existingAccessRequest = await accessCodeRequestRepo.findOne({
      where: {
        user_id: user.id,
        course_id: course.id,
      },
      order: { requested_at: "DESC" },
    });

    if (existingAccessRequest) {
      existingAccessRequest.generated_code = accessCode;
      existingAccessRequest.status = AccessCodeRequestStatus.CODE_SENT;
      existingAccessRequest.code_sent_at = new Date();
      existingAccessRequest.processed_by_admin_id = adminId;
      existingAccessRequest.processed_at = new Date();
      await accessCodeRequestRepo.save(existingAccessRequest);
    } else {
      const accessCodeRequest = accessCodeRequestRepo.create({
        user_id: user.id,
        course_id: course.id,
        institution_id: course.institution_id,
        generated_code: accessCode,
        status: AccessCodeRequestStatus.CODE_SENT,
        code_sent_at: new Date(),
        processed_by_admin_id: adminId,
        processed_at: new Date(),
      });
      await accessCodeRequestRepo.save(accessCodeRequest);
    }

    // Send email to learner with the access code
    await sendEmail({
      to: user.email,
      subject: `Your Access Code for ${course.title}`,
      html: `
        <h2>Access Code Request Approved</h2>
        <p>Hello ${user.first_name || 'Learner'},</p>
        <p>Your request for an access code for the public SPOC course <strong>${course.title}</strong> has been approved.</p>
        <div style="background-color: #f0f0f0; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
          <h3 style="margin: 0; color: #333;">Your Access Code</h3>
          <p style="font-size: 32px; font-weight: bold; color: #4CAF50; margin: 10px 0;">${accessCode}</p>
        </div>
        <p>To enroll in the course:</p>
        <ol>
          <li>Go to the course page: <a href="${process.env.CLIENT_URL}/courses/${course.id}">${course.title}</a></li>
          <li>Enter the access code in the provided field</li>
          <li>Click "Verify & Enroll" to gain immediate access</li>
        </ol>
        <p>This code is for your personal use only and should not be shared.</p>
        <p>Happy learning!</p>
        <hr>
        <p><a href="${process.env.CLIENT_URL}/courses/${course.id}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Course</a></p>
      `,
    });

    res.json({
      success: true,
      message: `Access code sent to ${user.email}`,
      data: {
        access_code: accessCode,
        user_email: user.email,
        course_title: course.title,
        code_sent_at: new Date(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to send access code",
      error: error.message,
    });
  }
}

  static async approvePublicCourseEnrollment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;
  
      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId } });
      
      if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({
          success: false,
          message: "Access denied. System admin privileges required.",
        });
      }
  
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const courseRepo = dbConnection.getRepository(Course);
      
      const enrollment = await enrollmentRepo.findOne({
        where: { id },
        relations: ["user", "course"],
      });
  
      if (!enrollment) {
        return res.status(404).json({
          success: false,
          message: "Enrollment request not found",
        });
      }
  
      if (enrollment.approval_status !== "PENDING") {
        return res.status(400).json({
          success: false,
          message: `Enrollment already ${enrollment.approval_status?.toLowerCase() || 'processed'}`,
        });
      }
  
      enrollment.approval_status = "APPROVED";
      enrollment.status = "ACTIVE";
      enrollment.approved_by_user_id = userId;
      enrollment.approval_date = new Date();
  
      await enrollmentRepo.save(enrollment);
  
      // Update course enrollment count
      if (enrollment.course) {
        enrollment.course.enrollment_count = (enrollment.course.enrollment_count || 0) + 1;
        await courseRepo.save(enrollment.course);
      }
  
      // Send approval email
      await sendEmail({
        to: enrollment.user.email,
        subject: `Enrollment Approved: ${enrollment.course.title}`,
        html: `
          <h2>Enrollment Approved!</h2>
          <p>Your enrollment request for <strong>${enrollment.course.title}</strong> has been approved.</p>
          <p>You can now access the course at ${process.env.CLIENT_URL}/courses/${enrollment.course.id}/learn</p>
        `,
      });
  
      res.json({
        success: true,
        message: "Enrollment approved successfully",
        data: {
          id: enrollment.id,
          status: enrollment.status,
          approval_status: enrollment.approval_status,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to approve enrollment",
        error: error.message,
      });
    }
  }
  
  static async rejectPublicCourseEnrollment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { rejection_reason } = req.body;
      const userId = req.user?.userId || req.user?.id;
  
      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId } });
      
      if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
        return res.status(403).json({
          success: false,
          message: "Access denied. System admin privileges required.",
        });
      }
  
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const enrollment = await enrollmentRepo.findOne({
        where: { id },
        relations: ["user", "course"],
      });
  
      if (!enrollment) {
        return res.status(404).json({
          success: false,
          message: "Enrollment request not found",
        });
      }
  
      if (enrollment.approval_status !== "PENDING") {
        return res.status(400).json({
          success: false,
          message: `Enrollment already ${enrollment.approval_status?.toLowerCase() || 'processed'}`,
        });
      }
  
      enrollment.approval_status = "REJECTED";
      enrollment.status = "DROPPED";
      enrollment.approved_by_user_id = userId;
      enrollment.approval_date = new Date();
  
      await enrollmentRepo.save(enrollment);
  
      // Send rejection email
      await sendEmail({
        to: enrollment.user.email,
        subject: `Enrollment Request Status: ${enrollment.course.title}`,
        html: `
          <h2>Enrollment Request Update</h2>
          <p>Unfortunately, your enrollment request for <strong>${enrollment.course.title}</strong> was not approved at this time.</p>
          ${rejection_reason ? `<p><strong>Reason:</strong> ${rejection_reason}</p>` : ""}
          <p>Please contact support for more information.</p>
        `,
      });
  
      res.json({
        success: true,
        message: "Enrollment rejected",
        data: {
          id: enrollment.id,
          status: enrollment.status,
          approval_status: enrollment.approval_status,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to reject enrollment",
        error: error.message,
      });
    }
  }

static async exportEnrollmentAnalytics(req: Request, res: Response) {
  try {
    const { institution_id, format = 'csv' } = req.query;

    if (!institution_id) {
      return res.status(400).json({
        success: false,
        message: "Institution ID is required",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);

    const enrollments = await enrollmentRepo.find({
      where: { institution_id: institution_id as string },
      relations: ["user", "course"],
      order: { enrolled_at: "DESC" },
    });

    if (format === 'csv') {
      const headers = [
        'Enrollment ID',
        'Student ID',
        'Student Email',
        'Student Name',
        'Course ID',
        'Course Title',
        'Course Type',
        'Enrolled Date',
        'Status',
        'Approval Status',
        'Progress %',
        'Completed Lessons',
        'Total Time (min)',
        'Completion Date',
        'Certificate Issued',
        'Final Score',
        'Last Accessed',
      ];

      const rows = enrollments.map(e => [
        e.id,
        e.user.id,
        e.user.email,
        `${e.user.first_name || ''} ${e.user.last_name || ''}`.trim(),
        e.course.id,
        e.course.title,
        e.course.course_type,
        e.enrolled_at.toISOString(),
        e.status,
        e.approval_status || '',
        e.progress_percentage,
        e.completed_lessons,
        e.total_time_spent_minutes,
        e.completion_date?.toISOString() || '',
        e.certificate_issued ? 'Yes' : 'No',
        e.final_score || '',
        e.last_accessed?.toISOString() || '',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=enrollment_analytics_${format(new Date(), 'yyyy-MM-dd')}.csv`);

      return res.send(csvContent);
    }

    res.json({
      success: true,
      data: enrollments,
      total: enrollments.length,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to export enrollment analytics",
      error: error.message,
    });
  }
}


  
  static async getUserEnrollmentsByUserId(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const requestingUserId = req.user?.userId || req.user?.id;
      const { 
        status,
        page = 1,
        limit = 20,
        include_course_details = true
      } = req.query;

      const userRepo = dbConnection.getRepository(User);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      // Get requesting user to check permissions
      const requestingUser = await userRepo.findOne({ where: { id: requestingUserId } });
      if (!requestingUser) {
        return res.status(401).json({ 
          success: false, 
          message: "Unauthorized - User not found" 
        });
      }

      // Build where clause
      let whereClause: any = { user_id: userId };
      
      // Add status filter if provided
      if (status) {
        whereClause.status = status;
      }

      // Calculate pagination
      const skip = (Number(page) - 1) * Number(limit);

      // Build relations array based on include_course_details
      const relations: string[] = ["course", "user"];
      if (include_course_details) {
        relations.push(
          "course.instructor",
          "course.course_category",
          "course.institution",
          "course.modules",
          "course.modules.lessons"
        );
      }

      // Fetch enrollments with pagination
      const [enrollments, total] = await enrollmentRepo.findAndCount({
        where: whereClause,
        relations: relations,
        order: { enrolled_at: "DESC" },
        skip,
        take: Number(limit),
      });

      // Transform data to match frontend expectations
      const transformedEnrollments = enrollments.map(enrollment => ({
        id: enrollment.id,
        user_id: enrollment.user_id,
        user: {
          id: enrollment.user.id,
          email: enrollment.user.email,
          first_name: enrollment.user.first_name,
          last_name: enrollment.user.last_name,
          profile_picture_url: enrollment.user.profile_picture_url,
        },
        course_id: enrollment.course_id,
        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          description: enrollment.course.description,
          thumbnail_url: enrollment.course.thumbnail_url,
          instructor: enrollment.course.instructor ? {
            id: enrollment.course.instructor.id,
            first_name: enrollment.course.instructor.first_name,
            last_name: enrollment.course.instructor.last_name,
            profile_picture_url: enrollment.course.instructor.profile_picture_url,
            email: enrollment.course.instructor.email,
          } : null,
          level: enrollment.course.level,
          price: enrollment.course.price,
          status: enrollment.course.status,
          is_certificate_available: enrollment.course.is_certificate_available,
          course_type: enrollment.course.course_type,
          duration_minutes: enrollment.course.duration_minutes,
          language: enrollment.course.language,
          average_rating: enrollment.course.average_rating,
          total_reviews: enrollment.course.total_reviews,
          enrollment_count: enrollment.course.enrollment_count,
          ...(include_course_details && {
            modules: enrollment.course.modules?.map(module => ({
              id: module.id,
              title: module.title,
              lessons: module.lessons?.map(lesson => ({
                id: lesson.id,
                title: lesson.title,
                duration_minutes: lesson.duration_minutes,
              })) || [],
            })) || [],
          }),
        },
        progress_percentage: enrollment.progress_percentage,
        status: enrollment.status,
        approval_status: enrollment.approval_status,
        request_type: enrollment.request_type,
        access_code_used: enrollment.access_code_used,
        access_code_sent: enrollment.access_code_sent,
        total_time_spent_minutes: enrollment.total_time_spent_minutes,
        completed_lessons: enrollment.completed_lessons,
        enrolled_at: enrollment.enrolled_at.toISOString(),
        last_accessed: enrollment.last_accessed?.toISOString(),
        certificate_issued: enrollment.certificate_issued,
        final_score: enrollment.final_score,
        enrollment_end_date: enrollment.enrollment_end_date?.toISOString(),
      }));

      res.json({
        success: true,
        message: "User enrollments retrieved successfully",
        data: transformedEnrollments,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch user enrollments",
        error: error.message,
      });
    }
  }

  static async getPendingEnrollmentsCount(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - User ID not found",
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - User not found",
        });
      }

      let count = 0;

      // System Admin can see all pending enrollments
      if (user.bwenge_role === "SYSTEM_ADMIN") {
        count = await enrollmentRepo.count({
          where: {
            status: EnrollmentStatus.PENDING,
            approval_status: EnrollmentApprovalStatus.PENDING,
          },
        });
      }
      // Institution Admin can see pending enrollments for their institution courses
      else if (user.bwenge_role === "INSTITUTION_ADMIN" && user.primary_institution_id) {
        count = await enrollmentRepo.count({
          where: {
            status: EnrollmentStatus.PENDING,
            approval_status: EnrollmentApprovalStatus.PENDING,
            institution_id: user.primary_institution_id,
          },
        });
      }
      // Instructors can see pending enrollments for their courses
      else if (user.bwenge_role === "INSTRUCTOR" || user.bwenge_role === "CONTENT_CREATOR") {
        const courseRepo = dbConnection.getRepository(Course);
        const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

        // Get courses where user is primary instructor
        const primaryCourses = await courseRepo.find({
          where: { instructor_id: userId },
          select: ["id"],
        });

        // Get courses where user is assigned as course instructor with manage permissions
        const assignedCourses = await courseInstructorRepo.find({
          where: {
            instructor_id: userId,
            can_manage_enrollments: true,
          },
          select: ["course_id"],
        });

        const courseIds = [
          ...primaryCourses.map(c => c.id),
          ...assignedCourses.map(c => c.course_id),
        ];

        if (courseIds.length > 0) {
          count = await enrollmentRepo
            .createQueryBuilder("enrollment")
            .where("enrollment.course_id IN (:...courseIds)", { courseIds })
            .andWhere("enrollment.status = :status", { status: EnrollmentStatus.PENDING })
            .andWhere("enrollment.approval_status = :approvalStatus", {
              approvalStatus: EnrollmentApprovalStatus.PENDING,
            })
            .getCount();
        }
      }

      res.json({
        success: true,
        message: "Pending enrollments count retrieved successfully",
        data: { count },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to get pending enrollments count",
        error: error.message,
      });
    }
  }

  static async getAllPendingEnrollments(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { page = 1, limit = 20, status_filter } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - User ID not found",
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - User not found",
        });
      }

      let whereClause: any = {
        status: EnrollmentStatus.PENDING,
        approval_status: EnrollmentApprovalStatus.PENDING,
      };

      // Apply status filter if provided
      if (status_filter && status_filter !== "PENDING") {
        if (status_filter === "ACTIVE") {
          whereClause = {
            status: EnrollmentStatus.ACTIVE,
            approval_status: EnrollmentApprovalStatus.APPROVED,
          };
        } else if (status_filter === "REJECTED") {
          whereClause = {
            approval_status: EnrollmentApprovalStatus.REJECTED,
          };
        } else if (status_filter === "ALL") {
          whereClause = {}; // No status filter
        }
      }

      let enrollments: Enrollment[] = [];
      let total = 0;

      const skip = (Number(page) - 1) * Number(limit);

      // System Admin can see all pending enrollments
      if (user.bwenge_role === "SYSTEM_ADMIN") {
        [enrollments, total] = await enrollmentRepo.findAndCount({
          where: whereClause,
          relations: [
            "user",
            "course",
            "course.instructor",
            "course.course_category",
            "course.institution",
          ],
          order: { enrolled_at: "DESC" },
          skip,
          take: Number(limit),
        });
      }
      // Institution Admin can see pending enrollments for their institution courses
      else if (user.bwenge_role === "INSTITUTION_ADMIN" && user.primary_institution_id) {
        whereClause.institution_id = user.primary_institution_id;
        [enrollments, total] = await enrollmentRepo.findAndCount({
          where: whereClause,
          relations: [
            "user",
            "course",
            "course.instructor",
            "course.course_category",
            "course.institution",
          ],
          order: { enrolled_at: "DESC" },
          skip,
          take: Number(limit),
        });
      }
      // Instructors can see pending enrollments for their courses
      else if (user.bwenge_role === "INSTRUCTOR" || user.bwenge_role === "CONTENT_CREATOR") {
        const courseRepo = dbConnection.getRepository(Course);
        const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

        // Get courses where user is primary instructor
        const primaryCourses = await courseRepo.find({
          where: { instructor_id: userId },
          select: ["id"],
        });

        // Get courses where user is assigned as course instructor with manage permissions
        const assignedCourses = await courseInstructorRepo.find({
          where: {
            instructor_id: userId,
            can_manage_enrollments: true,
          },
          select: ["course_id"],
        });

        const courseIds = [
          ...primaryCourses.map(c => c.id),
          ...assignedCourses.map(c => c.course_id),
        ];

        if (courseIds.length > 0) {
          const queryBuilder = enrollmentRepo
            .createQueryBuilder("enrollment")
            .leftJoinAndSelect("enrollment.user", "user")
            .leftJoinAndSelect("enrollment.course", "course")
            .leftJoinAndSelect("course.instructor", "instructor")
            .leftJoinAndSelect("course.course_category", "course_category")
            .leftJoinAndSelect("course.institution", "institution")
            .where("enrollment.course_id IN (:...courseIds)", { courseIds });

          // Apply status filters
          if (whereClause.status) {
            queryBuilder.andWhere("enrollment.status = :status", { status: whereClause.status });
          }
          if (whereClause.approval_status) {
            queryBuilder.andWhere("enrollment.approval_status = :approvalStatus", {
              approvalStatus: whereClause.approval_status,
            });
          }

          queryBuilder
            .orderBy("enrollment.enrolled_at", "DESC")
            .skip(skip)
            .take(Number(limit));

          [enrollments, total] = await queryBuilder.getManyAndCount();
        }
      } else {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view enrollment requests",
        });
      }

      // Transform data with user email included
      const transformedEnrollments = enrollments.map(enrollment => ({
        id: enrollment.id,
        user_id: enrollment.user_id,
        course_id: enrollment.course_id,
        user: {
          id: enrollment.user.id,
          email: enrollment.user.email,
          first_name: enrollment.user.first_name,
          last_name: enrollment.user.last_name,
          profile_picture_url: enrollment.user.profile_picture_url,
        },
        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          description: enrollment.course.description,
          thumbnail_url: enrollment.course.thumbnail_url,
          level: enrollment.course.level,
          price: enrollment.course.price,
          status: enrollment.course.status,
          is_certificate_available: enrollment.course.is_certificate_available,
          course_type: enrollment.course.course_type,
          institution_id: enrollment.course.institution_id,
          duration_minutes: enrollment.course.duration_minutes,
          language: enrollment.course.language,
          average_rating: enrollment.course.average_rating,
          total_reviews: enrollment.course.total_reviews,
          enrollment_count: enrollment.course.enrollment_count,
          instructor: enrollment.course.instructor ? {
            id: enrollment.course.instructor.id,
            first_name: enrollment.course.instructor.first_name,
            last_name: enrollment.course.instructor.last_name,
            profile_picture_url: enrollment.course.instructor.profile_picture_url,
            email: enrollment.course.instructor.email,
          } : null,
        },
        progress_percentage: enrollment.progress_percentage,
        status: enrollment.status,
        approval_status: enrollment.approval_status,
        request_type: enrollment.request_type,
        access_code_used: enrollment.access_code_used,
        access_code_sent: enrollment.access_code_sent,
        request_message: enrollment.request_message,
        total_time_spent_minutes: enrollment.total_time_spent_minutes,
        completed_lessons: enrollment.completed_lessons,
        enrolled_at: enrollment.enrolled_at.toISOString(),
        last_accessed: enrollment.last_accessed?.toISOString(),
        certificate_issued: enrollment.certificate_issued,
        final_score: enrollment.final_score,
        approval_date: enrollment.approval_date?.toISOString(),
      }));

      res.json({
        success: true,
        message: "Pending enrollments retrieved successfully",
        data: transformedEnrollments,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch pending enrollments",
        error: error.message,
      });
    }
  }

static async getUserEnrollments(req: Request, res: Response) {
  try {
    const { 
      user_id,
      status,
      page = 1,
      limit = 20,
      include_course_details = true
    } = req.body;

    const requestingUserId = req.user?.userId || req.user?.id;

    const userRepo = dbConnection.getRepository(User);
    const enrollmentRepo = dbConnection.getRepository(Enrollment);

    // Get requesting user to check permissions
    const requestingUser = await userRepo.findOne({ where: { id: requestingUserId } });
    if (!requestingUser) {
      return res.status(401).json({ 
        success: false, 
        message: "Unauthorized - User not found" 
      });
    }

    let whereClause: any = {};
    
    // Helper function to validate UUID
    const isValidUUID = (id: string): boolean => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(id);
    };
    
    if (user_id && user_id !== "all") {
      // Validate that user_id is a valid UUID before using in query
      if (!isValidUUID(user_id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID format",
        });
      }
      whereClause.user_id = user_id;
    } else if (user_id === "all") {
      if (requestingUser.bwenge_role === "INSTITUTION_ADMIN" && requestingUser.primary_institution_id) {
        whereClause.institution_id = requestingUser.primary_institution_id;
      }

      // For instructors, filter by their courses
      if (requestingUser.bwenge_role === "INSTRUCTOR") {
        const courseRepo = dbConnection.getRepository(Course);
        const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

        const primaryCourses = await courseRepo.find({
          where: { instructor_id: requestingUserId },
          select: ["id"],
        });

        const assignedCourses = await courseInstructorRepo.find({
          where: {
            instructor_id: requestingUserId,
            can_manage_enrollments: true,
          },
          select: ["course_id"],
        });

        const courseIds = [
          ...primaryCourses.map(c => c.id),
          ...assignedCourses.map(c => c.course_id),
        ];

        if (courseIds.length === 0) {
          return res.json({
            success: true,
            message: "No enrollments found",
            data: [],
            pagination: {
              page: parseInt(page as string),
              limit: parseInt(limit as string),
              total: 0,
              totalPages: 0,
            },
          });
        }

        const skip = (Number(page) - 1) * Number(limit);

        const queryBuilder = enrollmentRepo
          .createQueryBuilder("enrollment")
          .leftJoinAndSelect("enrollment.course", "course")
          .leftJoinAndSelect("enrollment.user", "user");

        if (include_course_details) {
          queryBuilder
            .leftJoinAndSelect("course.instructor", "instructor")
            .leftJoinAndSelect("course.course_category", "course_category")
            .leftJoinAndSelect("course.institution", "institution")
            .leftJoinAndSelect("course.modules", "modules")
            .leftJoinAndSelect("modules.lessons", "lessons");
        }

        queryBuilder.where("enrollment.course_id IN (:...courseIds)", { courseIds });

        if (status) {
          queryBuilder.andWhere("enrollment.status = :status", { status });
        }

        queryBuilder
          .orderBy("enrollment.enrolled_at", "DESC")
          .skip(skip)
          .take(Number(limit));

        const [enrollments, total] = await queryBuilder.getManyAndCount();

        const transformedEnrollments = enrollments.map(enrollment => ({
          id: enrollment.id,
          user_id: enrollment.user_id,
          user: {
            id: enrollment.user.id,
            email: enrollment.user.email,
            first_name: enrollment.user.first_name,
            last_name: enrollment.user.last_name,
            profile_picture_url: enrollment.user.profile_picture_url,
          },
          course_id: enrollment.course_id,
          course: {
            id: enrollment.course.id,
            title: enrollment.course.title,
            description: enrollment.course.description,
            thumbnail_url: enrollment.course.thumbnail_url,
            instructor: enrollment.course.instructor ? {
              id: enrollment.course.instructor.id,
              first_name: enrollment.course.instructor.first_name,
              last_name: enrollment.course.instructor.last_name,
              profile_picture_url: enrollment.course.instructor.profile_picture_url,
              email: enrollment.course.instructor.email,
            } : null,
            level: enrollment.course.level,
            price: enrollment.course.price,
            status: enrollment.course.status,
            is_certificate_available: enrollment.course.is_certificate_available,
            course_type: enrollment.course.course_type,
            duration_minutes: enrollment.course.duration_minutes,
            language: enrollment.course.language,
            average_rating: enrollment.course.average_rating,
            total_reviews: enrollment.course.total_reviews,
            enrollment_count: enrollment.course.enrollment_count,
            ...(include_course_details && {
              modules: enrollment.course.modules?.map(module => ({
                id: module.id,
                title: module.title,
                lessons: module.lessons?.map(lesson => ({
                  id: lesson.id,
                  title: lesson.title,
                  duration_minutes: lesson.duration_minutes,
                })) || [],
              })) || [],
            }),
          },
          progress_percentage: enrollment.progress_percentage,
          status: enrollment.status,
          approval_status: enrollment.approval_status,
          request_type: enrollment.request_type,
          access_code_used: enrollment.access_code_used,
          access_code_sent: enrollment.access_code_sent,
          total_time_spent_minutes: enrollment.total_time_spent_minutes,
          completed_lessons: enrollment.completed_lessons,
          enrolled_at: enrollment.enrolled_at.toISOString(),
          last_accessed: enrollment.last_accessed?.toISOString(),
          certificate_issued: enrollment.certificate_issued,
          final_score: enrollment.final_score,
        }));

        return res.json({
          success: true,
          message: "User enrollments retrieved successfully",
          data: transformedEnrollments,
          pagination: {
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        });
      }
    } else {
      // No user_id provided, return requesting user's enrollments
      whereClause.user_id = requestingUserId;
    }

    // Add status filter if provided
    if (status) {
      whereClause.status = status;
    }

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Build relations array based on include_course_details
    const relations: string[] = ["course", "user"];
    if (include_course_details) {
      relations.push(
        "course.instructor",
        "course.course_category",
        "course.institution",
        "course.modules",
        "course.modules.lessons"
      );
    }

    // Fetch enrollments with pagination
    const [enrollments, total] = await enrollmentRepo.findAndCount({
      where: whereClause,
      relations: relations,
      order: { enrolled_at: "DESC" },
      skip,
      take: Number(limit),
    });

    // Transform data
    const transformedEnrollments = enrollments.map(enrollment => ({
      id: enrollment.id,
      user_id: enrollment.user_id,
      user: {
        id: enrollment.user.id,
        email: enrollment.user.email,
        first_name: enrollment.user.first_name,
        last_name: enrollment.user.last_name,
        profile_picture_url: enrollment.user.profile_picture_url,
      },
      course_id: enrollment.course_id,
      course: {
        id: enrollment.course.id,
        title: enrollment.course.title,
        description: enrollment.course.description,
        thumbnail_url: enrollment.course.thumbnail_url,
        instructor: enrollment.course.instructor ? {
          id: enrollment.course.instructor.id,
          first_name: enrollment.course.instructor.first_name,
          last_name: enrollment.course.instructor.last_name,
          profile_picture_url: enrollment.course.instructor.profile_picture_url,
          email: enrollment.course.instructor.email,
        } : null,
        level: enrollment.course.level,
        price: enrollment.course.price,
        status: enrollment.course.status,
        is_certificate_available: enrollment.course.is_certificate_available,
        course_type: enrollment.course.course_type,
        duration_minutes: enrollment.course.duration_minutes,
        language: enrollment.course.language,
        average_rating: enrollment.course.average_rating,
        total_reviews: enrollment.course.total_reviews,
        enrollment_count: enrollment.course.enrollment_count,
        ...(include_course_details && {
          modules: enrollment.course.modules?.map(module => ({
            id: module.id,
            title: module.title,
            lessons: module.lessons?.map(lesson => ({
              id: lesson.id,
              title: lesson.title,
              duration_minutes: lesson.duration_minutes,
            })) || [],
          })) || [],
        }),
      },
      progress_percentage: enrollment.progress_percentage,
      status: enrollment.status,
      approval_status: enrollment.approval_status,
      request_type: enrollment.request_type,
      access_code_used: enrollment.access_code_used,
      access_code_sent: enrollment.access_code_sent,
      total_time_spent_minutes: enrollment.total_time_spent_minutes,
      completed_lessons: enrollment.completed_lessons,
      enrolled_at: enrollment.enrolled_at.toISOString(),
      last_accessed: enrollment.last_accessed?.toISOString(),
      certificate_issued: enrollment.certificate_issued,
      final_score: enrollment.final_score,
    }));

    res.json({
      success: true,
      message: "User enrollments retrieved successfully",
      data: transformedEnrollments,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch user enrollments",
      error: error.message,
    });
  }
}
  
  static async checkEnrollmentEligibility(req: Request, res: Response) {
    try {
      const { course_id } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      const course = await courseRepo.findOne({ where: { id: course_id } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if already enrolled
      const existingEnrollment = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id },
      });

      if (existingEnrollment && existingEnrollment.status === EnrollmentStatus.ACTIVE) {
        return res.json({
          success: true,
          data: {
            eligible: false,
            reason: "Already enrolled",
            requires_access_code: false,
            requires_approval: false,
            is_enrolled: true,
          },
        });
      }

      // MOOC courses are open to all
      if (course.course_type === CourseType.MOOC) {
        return res.json({
          success: true,
          data: {
            eligible: true,
            reason: "MOOC course - open to all",
            requires_access_code: false,
            requires_approval: false,
            is_enrolled: false,
          },
        });
      }

      // ==================== SPOC ENROLLMENT LOGIC ====================
      if (course.course_type === CourseType.SPOC) {
        // Check institution membership if course has institution
        let isMember = false;
        if (course.institution_id) {
          const membership = await memberRepo.findOne({
            where: {
              user_id: userId,
              institution_id: course.institution_id,
              is_active: true,
            },
          });
          isMember = !!membership;
        }

        // Check if user has a pending access code request
        const pendingRequest = await enrollmentRepo.findOne({
          where: {
            user_id: userId,
            course_id,
            request_type: EnrollmentRequestType.ACCESS_CODE_REQUEST,
            status: EnrollmentStatus.PENDING,
          },
        });

        // If member of institution and course doesn't require approval
        if (isMember && !course.requires_approval) {
          return res.json({
            success: true,
            data: {
              eligible: true,
              reason: "Institution member",
              requires_access_code: false,
              requires_approval: false,
              is_member: true,
              is_enrolled: false,
            },
          });
        }

        // If member but course requires approval
        if (isMember && course.requires_approval) {
          return res.json({
            success: true,
            data: {
              eligible: true,
              reason: "Institution member with approval required",
              requires_access_code: false,
              requires_approval: true,
              is_member: true,
              is_enrolled: false,
            },
          });
        }

        // If not a member but course has available access codes
        const hasAccessCodes = course.access_codes && course.access_codes.length > 0;
        
        if (!isMember && course.institution_id && hasAccessCodes) {
          return res.json({
            success: true,
            data: {
              eligible: true,
              reason: "Access code required",
              requires_access_code: true,
              requires_approval: false,
              is_member: false,
              has_pending_request: !!pendingRequest,
              is_enrolled: false,
            },
          });
        }

        // If not a member and no access codes available
        if (!isMember && course.institution_id && !hasAccessCodes) {
          return res.json({
            success: true,
            data: {
              eligible: false,
              reason: "Not an institution member",
              requires_access_code: false,
              requires_approval: false,
              is_member: false,
              is_enrolled: false,
              message: "You must be a member of this institution to enroll",
            },
          });
        }

        // Public SPOC course (no institution)
        if (!course.institution_id) {
          return res.json({
            success: true,
            data: {
              eligible: true,
              reason: "Access code required for public SPOC course",
              requires_access_code: true,
              requires_approval: false,
              is_member: false,
              has_pending_request: !!pendingRequest,
              is_enrolled: false,
            },
          });
        }
      }

      res.json({
        success: true,
        data: {
          eligible: false,
          reason: "Unknown eligibility status",
          is_enrolled: false,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to check enrollment eligibility",
        error: error.message,
      });
    }
  }



  static async requestEnrollmentApproval(req: Request, res: Response) {
    try {
      const { course_id, message, access_code } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const userRepo = dbConnection.getRepository(User);

      const course = await courseRepo.findOne({
        where: { id: course_id },
        relations: ["instructor", "course_instructors", "institution"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Validate access code if provided
      if (access_code) {
        if (!course.access_codes || !course.access_codes.includes(access_code)) {
          return res.status(400).json({
            success: false,
            message: "Invalid access code",
          });
        }
      }

      // Check if already enrolled or pending
      const existing = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id },
      });

      if (existing) {
        if (existing.status === EnrollmentStatus.ACTIVE) {
          return res.status(400).json({
            success: false,
            message: "You are already enrolled in this course",
          });
        }
        if (existing.status === EnrollmentStatus.PENDING) {
          return res.status(400).json({
            success: false,
            message: "You already have a pending enrollment request for this course",
          });
        }
      }

      // Create pending enrollment (APPROVAL_REQUEST type)
      const enrollment = enrollmentRepo.create({
        user_id: userId,
        course_id,
        status: EnrollmentStatus.PENDING,
        approval_status: EnrollmentApprovalStatus.PENDING,
        request_type: EnrollmentRequestType.APPROVAL_REQUEST,
        request_message: message || null,
        access_code_used: access_code,
        institution_id: course.institution_id,
        requires_approval: true,
      });

      await enrollmentRepo.save(enrollment);

      // Notify instructors and admins
      const notifyEmails = [];
      if (course.instructor && course.instructor.email) {
        notifyEmails.push(course.instructor.email);
      }
      
      for (const instructor of course.course_instructors || []) {
        if (instructor.can_manage_enrollments && instructor.instructor && instructor.instructor.email) {
          notifyEmails.push(instructor.instructor.email);
        }
      }

      if (notifyEmails.length > 0) {
        await sendEmail({
          to: notifyEmails.join(","),
          subject: `Enrollment Request: ${course.title}`,
          html: `
            <h2>New Enrollment Request</h2>
            <p><strong>${user.first_name} ${user.last_name}</strong> (${user.email}) has requested to enroll in <strong>${course.title}</strong>.</p>
            ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
            <p>Review the request at ${process.env.CLIENT_URL}/dashboard/instructor/enrollments</p>
          `,
        });
      }

      // Send in-app notification: pending acknowledgement to learner
      NotificationService.onEnrollmentPending(
        userId,
        course.title,
        enrollment.id
      ).catch(() => {});

      // Send in-app notification: new enrollment request to institution admins
      if (course.institution_id) {
        const studentName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
        NotificationService.onNewEnrollmentRequest(
          course.institution_id,
          studentName,
          course.title,
          enrollment.id,
          userId
        ).catch(() => {});
      }

      res.status(201).json({
        success: true,
        message: "Enrollment request submitted successfully",
        data: {
          id: enrollment.id,
          status: enrollment.status,
          request_type: enrollment.request_type,
          enrolled_at: enrollment.enrolled_at,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to request enrollment approval",
        error: error.message,
      });
    }
  }

  static async approveEnrollment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const courseRepo = dbConnection.getRepository(Course);
      
      const enrollment = await enrollmentRepo.findOne({
        where: { id },
        relations: ["user", "course"],
      });

      if (!enrollment) {
        return res.status(404).json({
          success: false,
          message: "Enrollment request not found",
        });
      }

      if (enrollment.approval_status !== EnrollmentApprovalStatus.PENDING) {
        return res.status(400).json({
          success: false,
          message: `Enrollment already ${enrollment.approval_status?.toLowerCase() || 'processed'}`,
        });
      }

      enrollment.approval_status = EnrollmentApprovalStatus.APPROVED;
      enrollment.status = EnrollmentStatus.ACTIVE;
      enrollment.approved_by_user_id = userId;
      enrollment.approval_date = new Date();

      await enrollmentRepo.save(enrollment);

      // Update course enrollment count
      if (enrollment.course) {
        enrollment.course.enrollment_count = (enrollment.course.enrollment_count || 0) + 1;
        await courseRepo.save(enrollment.course);
      }

      // Send approval email
      await sendEmail({
        to: enrollment.user.email,
        subject: `Enrollment Approved: ${enrollment.course.title}`,
        html: `
          <h2>Enrollment Approved!</h2>
          <p>Your enrollment request for <strong>${enrollment.course.title}</strong> has been approved.</p>
          <p>You can now access the course at ${process.env.CLIENT_URL}/courses/${enrollment.course.id}/learn</p>
        `,
      });

      // Send in-app notification to learner
      NotificationService.onEnrollmentApproved(
        enrollment.user_id,
        enrollment.course.title,
        enrollment.id,
        userId
      ).catch(() => {});

      // ── Real-time: Push enrollment status change to student ────────────────
      emitToUser(enrollment.user_id, "enrollment-approved", {
        enrollmentId: enrollment.id,
        courseId: enrollment.course_id,
        courseName: enrollment.course.title,
        status: enrollment.status,
        approvalStatus: enrollment.approval_status,
      });

      // ── Real-time: Update enrollment count for course viewers ─────────────
      emitToCourse(enrollment.course_id, "enrollment-count-updated", {
        courseId: enrollment.course_id,
        enrollmentCount: enrollment.course?.enrollment_count || 0,
      });

      res.json({
        success: true,
        message: "Enrollment approved successfully",
        data: {
          id: enrollment.id,
          status: enrollment.status,
          approval_status: enrollment.approval_status,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to approve enrollment",
        error: error.message,
      });
    }
  }

  static async rejectEnrollment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { rejection_reason } = req.body;
      const userId = req.user?.userId || req.user?.id;

      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const enrollment = await enrollmentRepo.findOne({
        where: { id },
        relations: ["user", "course"],
      });

      if (!enrollment) {
        return res.status(404).json({
          success: false,
          message: "Enrollment request not found",
        });
      }

      if (enrollment.approval_status !== EnrollmentApprovalStatus.PENDING) {
        return res.status(400).json({
          success: false,
          message: `Enrollment already ${enrollment.approval_status?.toLowerCase() || 'processed'}`,
        });
      }

      enrollment.approval_status = EnrollmentApprovalStatus.REJECTED;
      enrollment.status = EnrollmentStatus.DROPPED;
      enrollment.approved_by_user_id = userId;
      enrollment.approval_date = new Date();

      await enrollmentRepo.save(enrollment);

      // Send rejection email
      await sendEmail({
        to: enrollment.user.email,
        subject: `Enrollment Request Status: ${enrollment.course.title}`,
        html: `
          <h2>Enrollment Request Update</h2>
          <p>Unfortunately, your enrollment request for <strong>${enrollment.course.title}</strong> was not approved at this time.</p>
          ${rejection_reason ? `<p><strong>Reason:</strong> ${rejection_reason}</p>` : ""}
          <p>Please contact the course instructor for more information.</p>
        `,
      });

      // Send in-app notification to learner
      NotificationService.onEnrollmentRejected(
        enrollment.user_id,
        enrollment.course.title,
        enrollment.id,
        userId
      ).catch(() => {});

      // ── Real-time: Push rejection status to student ───────────────────────
      emitToUser(enrollment.user_id, "enrollment-rejected", {
        enrollmentId: enrollment.id,
        courseId: enrollment.course_id,
        courseName: enrollment.course.title,
        status: enrollment.status,
        approvalStatus: enrollment.approval_status,
      });

      res.json({
        success: true,
        message: "Enrollment rejected",
        data: {
          id: enrollment.id,
          status: enrollment.status,
          approval_status: enrollment.approval_status,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to reject enrollment",
        error: error.message,
      });
    }
  }

  static async enrollDirect(req: Request, res: Response) {
    try {
      const { course_id } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const userRepo = dbConnection.getRepository(User);
      const memberRepo = dbConnection.getRepository(InstitutionMember);

      const course = await courseRepo.findOne({
        where: { id: course_id },
        relations: ["institution"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Validate eligibility for direct enrollment
      if (course.course_type !== CourseType.MOOC) {
        return res.status(400).json({
          success: false,
          message: "Direct enrollment is only available for MOOC courses",
        });
      }

      // If course has institution, check membership
      if (course.institution_id) {
        const membership = await memberRepo.findOne({
          where: {
            user_id: userId,
            institution_id: course.institution_id,
            is_active: true,
          },
        });

        if (!membership) {
          return res.status(403).json({
            success: false,
            message: "You must be a member of this institution to enroll",
          });
        }
      }

      // Check if already enrolled
      const existing = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id },
      });

      if (existing) {
        if (existing.status === EnrollmentStatus.ACTIVE) {
          return res.status(400).json({
            success: false,
            message: "You are already enrolled in this course",
          });
        }
        // If there's a pending request, update it to active
        existing.status = EnrollmentStatus.ACTIVE;
        existing.approval_status = EnrollmentApprovalStatus.APPROVED;
        existing.enrolled_at = new Date();
        await enrollmentRepo.save(existing);

        // Update course enrollment count
        course.enrollment_count = (course.enrollment_count || 0) + 1;
        await courseRepo.save(course);

        return res.status(200).json({
          success: true,
          message: "Successfully enrolled in course",
          data: {
            enrollment: {
              id: existing.id,
              status: existing.status,
              enrolled_at: existing.enrolled_at,
            },
            course: {
              id: course.id,
              title: course.title,
            },
          },
        });
      }

      // Create active enrollment
      const enrollment = enrollmentRepo.create({
        user_id: userId,
        course_id,
        status: EnrollmentStatus.ACTIVE,
        approval_status: EnrollmentApprovalStatus.APPROVED,
        requires_approval: false,
        institution_id: course.institution_id,
        enrolled_at: new Date(),
      });

      await enrollmentRepo.save(enrollment);

      // Update course enrollment count
      course.enrollment_count = (course.enrollment_count || 0) + 1;
      await courseRepo.save(course);

      // Send confirmation email
      await sendEmail({
        to: user.email,
        subject: `Enrolled in ${course.title}`,
        html: `
          <h2>Enrollment Successful!</h2>
          <p>You have been successfully enrolled in <strong>${course.title}</strong>.</p>
          <p>Start learning now: ${process.env.CLIENT_URL}/courses/${course.id}/learn</p>
        `,
      });

      res.status(201).json({
        success: true,
        message: "Successfully enrolled in course",
        data: {
          enrollment: {
            id: enrollment.id,
            status: enrollment.status,
            enrolled_at: enrollment.enrolled_at,
          },
          course: {
            id: course.id,
            title: course.title,
          },
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to enroll in course",
        error: error.message,
      });
    }
  }

  static async requestAccessCode(req: Request, res: Response) {
    try {
      const { course_id, message } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const institutionRepo = dbConnection.getRepository(Institution);
      const accessCodeRequestRepo = dbConnection.getRepository(AccessCodeRequest);

      const course = await courseRepo.findOne({
        where: { id: course_id },
        relations: ["institution", "instructor"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Validate this is a SPOC course
      if (course.course_type !== CourseType.SPOC) {
        return res.status(400).json({
          success: false,
          message: "Access code requests are only for SPOC courses",
        });
      }

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // If course has institution, check membership first
      if (course.institution_id) {
        const membership = await memberRepo.findOne({
          where: {
            user_id: userId,
            institution_id: course.institution_id,
            is_active: true,
          },
        });

        if (!membership) {
          return res.status(403).json({
            success: false,
            message: "You must be a member of this institution to request access",
          });
        }
      }

      // Check if already enrolled or has pending request
      const existing = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id },
      });

      if (existing) {
        if (existing.status === EnrollmentStatus.ACTIVE) {
          return res.status(400).json({
            success: false,
            message: "You are already enrolled in this course",
          });
        }
        
        if (existing.request_type === EnrollmentRequestType.ACCESS_CODE_REQUEST && 
            existing.approval_status === EnrollmentApprovalStatus.PENDING) {
          return res.status(400).json({
            success: false,
            message: "You already have a pending access code request for this course",
          });
        }
      }

      // Create access code request in main enrollment table
      const enrollment = enrollmentRepo.create({
        user_id: userId,
        course_id,
        status: EnrollmentStatus.PENDING,
        approval_status: EnrollmentApprovalStatus.PENDING,
        request_type: EnrollmentRequestType.ACCESS_CODE_REQUEST,
        request_message: message || null,
        requires_approval: true,
        institution_id: course.institution_id,
      });

      await enrollmentRepo.save(enrollment);

      // Also create entry in dedicated access_code_requests table
      const accessCodeRequest = accessCodeRequestRepo.create({
        user_id: userId,
        course_id,
        institution_id: course.institution_id,
        message: message || null,
        status: AccessCodeRequestStatus.PENDING,
      });
      await accessCodeRequestRepo.save(accessCodeRequest);

      // Determine who to notify
      let adminEmails: string[] = [];
      let adminNames: string[] = [];

      if (course.institution_id) {
        // Notify Institution Admins
        const institutionAdmins = await userRepo
          .createQueryBuilder("user")
          .innerJoin("institution_members", "member", "member.user_id = user.id")
          .where("member.institution_id = :institutionId", { institutionId: course.institution_id })
          .andWhere("member.role = :role", { role: "ADMIN" })
          .andWhere("member.is_active = :isActive", { isActive: true })
          .getMany();

        adminEmails = institutionAdmins.map(admin => admin.email);
        adminNames = institutionAdmins.map(admin => `${admin.first_name} ${admin.last_name}`);

        // Also include the institution's primary admin from user table
        const institution = await institutionRepo.findOne({
          where: { id: course.institution_id },
        });

        if (institution) {
          const primaryAdmins = await userRepo.find({
            where: {
              primary_institution_id: course.institution_id,
              bwenge_role: BwengeRole.INSTITUTION_ADMIN,
              is_active: true,
            },
          });
          
          primaryAdmins.forEach(admin => {
            if (!adminEmails.includes(admin.email)) {
              adminEmails.push(admin.email);
              adminNames.push(`${admin.first_name} ${admin.last_name}`);
            }
          });
        }
      } else {
        // Notify System Admins
        const systemAdmins = await userRepo.find({
          where: {
            bwenge_role: BwengeRole.SYSTEM_ADMIN,
            is_active: true,
          },
        });

        adminEmails = systemAdmins.map(admin => admin.email);
        adminNames = systemAdmins.map(admin => `${admin.first_name} ${admin.last_name}`);
      }

      // Send email notifications to admins
      if (adminEmails.length > 0) {
        const adminType = course.institution_id ? "Institution Admin" : "System Admin";
        
        await sendEmail({
          to: adminEmails.join(","),
          subject: `Access Code Request: ${course.title}`,
          html: `
            <h2>New Access Code Request</h2>
            <p><strong>${user.first_name} ${user.last_name}</strong> (${user.email}) has requested an access code for the SPOC course:</p>
            <p><strong>Course:</strong> ${course.title}</p>
            ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
            <p><strong>Request Type:</strong> Access Code Request</p>
            <p><strong>Requested:</strong> ${new Date().toLocaleString()}</p>
            <hr>
            <p>Please generate and send an access code to this learner.</p>
            <p><a href="${process.env.CLIENT_URL}/dashboard/${adminType.toLowerCase().replace(' ', '-')}/enrollments" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Manage Requests</a></p>
          `,
        });

        // Also notify course instructor
        if (course.instructor && course.instructor.email) {
          await sendEmail({
            to: course.instructor.email,
            subject: `Access Code Request: ${course.title}`,
            html: `
              <h2>Access Code Request Notification</h2>
              <p><strong>${user.first_name} ${user.last_name}</strong> (${user.email}) has requested an access code for your SPOC course:</p>
              <p><strong>Course:</strong> ${course.title}</p>
              ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
              <p>The appropriate admin has been notified and will handle the request.</p>
            `,
          });
        }
      }

      res.status(201).json({
        success: true,
        message: "Access code request submitted successfully. You will receive an email with the code when approved.",
        data: {
          request_id: enrollment.id,
          status: enrollment.status,
          requested_at: enrollment.enrolled_at,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to request access code",
        error: error.message,
      });
    }
  }

  static async redeemAccessCode(req: Request, res: Response) {
    try {
      const { course_id, access_code } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!course_id || !access_code) {
        return res.status(400).json({
          success: false,
          message: "Course ID and access code are required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const userRepo = dbConnection.getRepository(User);
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const accessCodeRequestRepo = dbConnection.getRepository(AccessCodeRequest);

      const course = await courseRepo.findOne({
        where: { id: course_id },
        relations: ["institution"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Validate this is a SPOC course
      if (course.course_type !== CourseType.SPOC) {
        return res.status(400).json({
          success: false,
          message: "Access codes are only for SPOC courses",
        });
      }

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // If course has institution, check membership
      if (course.institution_id) {
        const membership = await memberRepo.findOne({
          where: {
            user_id: userId,
            institution_id: course.institution_id,
            is_active: true,
          },
        });

        if (!membership) {
          return res.status(403).json({
            success: false,
            message: "You must be a member of this institution to redeem access codes",
          });
        }
      }

      // Check if access code exists in course's available access codes
      if (!course.access_codes || !course.access_codes.includes(access_code)) {
        return res.status(400).json({
          success: false,
          message: "Invalid access code",
        });
      }

      // Check if code has already been used by ANY user
      const enrollmentWithCode = await enrollmentRepo.findOne({
        where: { 
          course_id, 
          access_code_used: access_code,
        },
      });

      if (enrollmentWithCode) {
        return res.status(400).json({
          success: false,
          message: "This access code has already been used",
        });
      }

      // Check if user already has any enrollment for this course
      const existingEnrollment = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id },
      });

      if (existingEnrollment) {
        if (existingEnrollment.status === EnrollmentStatus.ACTIVE) {
          return res.status(400).json({
            success: false,
            message: "You are already enrolled in this course",
          });
        }
        
        // Update existing pending enrollment to active
        existingEnrollment.status = EnrollmentStatus.ACTIVE;
        existingEnrollment.approval_status = EnrollmentApprovalStatus.APPROVED;
        existingEnrollment.access_code_used = access_code;
        existingEnrollment.enrolled_at = new Date();
        await enrollmentRepo.save(existingEnrollment);

        // Remove the used code from course access_codes
        course.access_codes = course.access_codes.filter(code => code !== access_code);
        course.enrollment_count = (course.enrollment_count || 0) + 1;
        await courseRepo.save(course);

        // Update user's used codes
        await userRepo
          .createQueryBuilder()
          .update(User)
          .set({
            spoc_access_codes_used: () => `array_append(COALESCE("spoc_access_codes_used", '{}'), :code)`,
          })
          .where("id = :userId", { userId })
          .setParameter("code", access_code)
          .execute();

        // Update access code request record
        await accessCodeRequestRepo.update(
          { 
            user_id: userId, 
            course_id,
            generated_code: access_code 
          },
          { 
            status: AccessCodeRequestStatus.ENROLLED,
            processed_at: new Date() 
          }
        );

        return res.json({
          success: true,
          message: "Access code redeemed successfully",
          data: {
            enrollment: {
              id: existingEnrollment.id,
              status: existingEnrollment.status,
              enrolled_at: existingEnrollment.enrolled_at,
            },
            course: {
              id: course.id,
              title: course.title,
            },
          },
        });
      }

      // Check if there's a pending access code request for this user and course
      const pendingRequest = await enrollmentRepo.findOne({
        where: {
          user_id: userId,
          course_id,
          request_type: EnrollmentRequestType.ACCESS_CODE_REQUEST,
          status: EnrollmentStatus.PENDING,
          approval_status: EnrollmentApprovalStatus.PENDING,
          access_code_sent: true,
        },
      });

      // Create new active enrollment
      const enrollment = enrollmentRepo.create({
        user_id: userId,
        course_id,
        status: EnrollmentStatus.ACTIVE,
        approval_status: EnrollmentApprovalStatus.APPROVED,
        access_code_used: access_code,
        requires_approval: false,
        institution_id: course.institution_id,
        enrolled_at: new Date(),
        request_type: pendingRequest ? pendingRequest.request_type : undefined,
        request_message: pendingRequest ? pendingRequest.request_message : undefined,
      });

      await enrollmentRepo.save(enrollment);

      // Remove the used code from course access_codes
      course.access_codes = course.access_codes.filter(code => code !== access_code);
      course.enrollment_count = (course.enrollment_count || 0) + 1;
      await courseRepo.save(course);

      // Update user's used codes
      await userRepo
        .createQueryBuilder()
        .update(User)
        .set({
          spoc_access_codes_used: () => `array_append(COALESCE("spoc_access_codes_used", '{}'), :code)`,
        })
        .where("id = :userId", { userId })
        .setParameter("code", access_code)
        .execute();

      // If there was a pending request, mark it as completed
      if (pendingRequest) {
        pendingRequest.status = EnrollmentStatus.ACTIVE;
        pendingRequest.approval_status = EnrollmentApprovalStatus.APPROVED;
        pendingRequest.approval_date = new Date();
        await enrollmentRepo.save(pendingRequest);
      }

      // Update access code request record
      await accessCodeRequestRepo.update(
        { 
          user_id: userId, 
          course_id,
          generated_code: access_code,
          status: AccessCodeRequestStatus.CODE_SENT
        },
        { 
          status: AccessCodeRequestStatus.ENROLLED,
          processed_at: new Date() 
        }
      );

      // Send confirmation email
      await sendEmail({
        to: user.email,
        subject: `Enrolled in ${course.title}`,
        html: `
          <h2>Enrollment Successful!</h2>
          <p>You have been successfully enrolled in <strong>${course.title}</strong> using your access code.</p>
          <p>Start learning now: ${process.env.CLIENT_URL}/courses/${course.id}/learn</p>
        `,
      });

      // Notify institution admins about access code usage
      if (course.institution_id) {
        const studentName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
        NotificationService.onAccessCodeUsed(
          course.institution_id,
          course.title,
          studentName,
          course.id,
          userId
        ).catch(() => {});
      }

      res.status(201).json({
        success: true,
        message: "Access code redeemed and enrollment successful",
        data: {
          enrollment: {
            id: enrollment.id,
            status: enrollment.status,
            enrolled_at: enrollment.enrolled_at,
          },
          course: {
            id: course.id,
            title: course.title,
          },
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to redeem access code",
        error: error.message,
      });
    }
  }

  static async getAccessCodeRequests(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { page = 1, limit = 20, status = "PENDING" } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - User ID not found",
        });
      }

      const userRepo = dbConnection.getRepository(User);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - User not found",
        });
      }

      const skip = (Number(page) - 1) * Number(limit);
      let whereClause: any = {
        request_type: EnrollmentRequestType.ACCESS_CODE_REQUEST,
      };

      // Apply status filter
      if (status === "PENDING") {
        whereClause.status = EnrollmentStatus.PENDING;
        whereClause.approval_status = EnrollmentApprovalStatus.PENDING;
        whereClause.access_code_sent = false;
      } else if (status === "CODE_SENT") {
        whereClause.access_code_sent = true;
        whereClause.status = EnrollmentStatus.PENDING;
      } else if (status === "ENROLLED") {
        whereClause.status = EnrollmentStatus.ACTIVE;
      }

      let requests: Enrollment[] = [];
      let total = 0;

      // System Admin: See all requests for courses with no institution
      if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
        const courseRepo = dbConnection.getRepository(Course);
        const publicSpocCourses = await courseRepo.find({
          where: {
            institution_id: null,
            course_type: CourseType.SPOC,
          },
          select: ["id"],
        });

        const courseIds = publicSpocCourses.map(c => c.id);

        if (courseIds.length > 0) {
          const queryBuilder = enrollmentRepo
            .createQueryBuilder("enrollment")
            .leftJoinAndSelect("enrollment.user", "user")
            .leftJoinAndSelect("enrollment.course", "course")
            .leftJoinAndSelect("course.instructor", "instructor")
            .leftJoinAndSelect("course.course_category", "course_category")
            .where("enrollment.request_type = :requestType", { requestType: EnrollmentRequestType.ACCESS_CODE_REQUEST })
            .andWhere("enrollment.course_id IN (:...courseIds)", { courseIds });

          if (status === "PENDING") {
            queryBuilder
              .andWhere("enrollment.status = :status", { status: EnrollmentStatus.PENDING })
              .andWhere("enrollment.approval_status = :approvalStatus", { approvalStatus: EnrollmentApprovalStatus.PENDING })
              .andWhere("enrollment.access_code_sent = :accessCodeSent", { accessCodeSent: false });
          } else if (status === "CODE_SENT") {
            queryBuilder
              .andWhere("enrollment.access_code_sent = :accessCodeSent", { accessCodeSent: true })
              .andWhere("enrollment.status = :status", { status: EnrollmentStatus.PENDING });
          } else if (status === "ENROLLED") {
            queryBuilder.andWhere("enrollment.status = :activeStatus", { activeStatus: EnrollmentStatus.ACTIVE });
          }

          queryBuilder
            .orderBy("enrollment.enrolled_at", "DESC")
            .skip(skip)
            .take(Number(limit));

          [requests, total] = await queryBuilder.getManyAndCount();
        }
      }
      // Institution Admin: See requests for their institution's courses
      else if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN && user.primary_institution_id) {
        whereClause.institution_id = user.primary_institution_id;

        [requests, total] = await enrollmentRepo.findAndCount({
          where: whereClause,
          relations: ["user", "course", "course.instructor", "course.institution"],
          order: { enrolled_at: "DESC" },
          skip,
          take: Number(limit),
        });
      }
      // Instructors: See requests for their courses
      else if (user.bwenge_role === BwengeRole.INSTRUCTOR || user.bwenge_role === BwengeRole.CONTENT_CREATOR) {
        const courseRepo = dbConnection.getRepository(Course);
        const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

        const primaryCourses = await courseRepo.find({
          where: { instructor_id: userId },
          select: ["id"],
        });

        const assignedCourses = await courseInstructorRepo.find({
          where: { instructor_id: userId },
          select: ["course_id"],
        });

        const courseIds = [
          ...primaryCourses.map(c => c.id),
          ...assignedCourses.map(c => c.course_id),
        ];

        if (courseIds.length > 0) {
          const queryBuilder = enrollmentRepo
            .createQueryBuilder("enrollment")
            .leftJoinAndSelect("enrollment.user", "user")
            .leftJoinAndSelect("enrollment.course", "course")
            .leftJoinAndSelect("course.instructor", "instructor")
            .leftJoinAndSelect("course.institution", "institution")
            .where("enrollment.request_type = :requestType", { requestType: EnrollmentRequestType.ACCESS_CODE_REQUEST })
            .andWhere("enrollment.course_id IN (:...courseIds)", { courseIds });

          if (status === "PENDING") {
            queryBuilder
              .andWhere("enrollment.status = :status", { status: EnrollmentStatus.PENDING })
              .andWhere("enrollment.approval_status = :approvalStatus", { approvalStatus: EnrollmentApprovalStatus.PENDING })
              .andWhere("enrollment.access_code_sent = :accessCodeSent", { accessCodeSent: false });
          } else if (status === "CODE_SENT") {
            queryBuilder
              .andWhere("enrollment.access_code_sent = :accessCodeSent", { accessCodeSent: true })
              .andWhere("enrollment.status = :status", { status: EnrollmentStatus.PENDING });
          } else if (status === "ENROLLED") {
            queryBuilder.andWhere("enrollment.status = :activeStatus", { activeStatus: EnrollmentStatus.ACTIVE });
          }

          queryBuilder
            .orderBy("enrollment.enrolled_at", "DESC")
            .skip(skip)
            .take(Number(limit));

          [requests, total] = await queryBuilder.getManyAndCount();
        }
      } else {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view access code requests",
        });
      }

      // Transform data
      const transformedRequests = requests.map(request => ({
        id: request.id,
        user: {
          id: request.user.id,
          email: request.user.email,
          first_name: request.user.first_name,
          last_name: request.user.last_name,
          profile_picture_url: request.user.profile_picture_url,
        },
        course: {
          id: request.course.id,
          title: request.course.title,
          course_type: request.course.course_type,
          thumbnail_url: request.course.thumbnail_url,
          institution: request.course.institution ? {
            id: request.course.institution.id,
            name: request.course.institution.name,
          } : null,
          instructor: request.course.instructor ? {
            id: request.course.instructor.id,
            first_name: request.course.instructor.first_name,
            last_name: request.course.instructor.last_name,
            email: request.course.instructor.email,
          } : null,
        },
        request_message: request.request_message,
        requested_at: request.enrolled_at,
        status: request.status,
        approval_status: request.approval_status,
        access_code_sent: request.access_code_sent,
        access_code_sent_at: request.access_code_sent_at,
        institution_id: request.institution_id,
      }));

      res.json({
        success: true,
        message: "Access code requests retrieved successfully",
        data: transformedRequests,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch access code requests",
        error: error.message,
      });
    }
  }

  static async sendAccessCode(req: Request, res: Response) {
    try {
      const { enrollment_request_id, user_id, course_id } = req.body;
      const adminId = req.user?.userId || req.user?.id;

      if (!enrollment_request_id && (!user_id || !course_id)) {
        return res.status(400).json({
          success: false,
          message: "Either enrollment_request_id or both user_id and course_id are required",
        });
      }

      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);
      const accessCodeRequestRepo = dbConnection.getRepository(AccessCodeRequest);

      let targetUserId = user_id;
      let targetCourseId = course_id;
      let enrollmentRequest: Enrollment | null = null;

      // If enrollment_request_id is provided, get details from it
      if (enrollment_request_id) {
        enrollmentRequest = await enrollmentRepo.findOne({
          where: { id: enrollment_request_id },
          relations: ["user", "course"],
        });

        if (!enrollmentRequest) {
          return res.status(404).json({
            success: false,
            message: "Enrollment request not found",
          });
        }

        targetUserId = enrollmentRequest.user_id;
        targetCourseId = enrollmentRequest.course_id;
      }

      const course = await courseRepo.findOne({
        where: { id: targetCourseId },
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const user = await userRepo.findOne({
        where: { id: targetUserId },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if course is SPOC
      if (course.course_type !== CourseType.SPOC) {
        return res.status(400).json({
          success: false,
          message: "Access codes can only be generated for SPOC courses",
        });
      }

      // Generate a unique access code
      const generateUniqueCode = (): string => {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
          code += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return code;
      };

      let accessCode = generateUniqueCode();
      
      // Ensure code is unique in the course and not already used
      const isCodeUsed = async (code: string): Promise<boolean> => {
        // Check if code already exists in course.access_codes
        if (course.access_codes && course.access_codes.includes(code)) {
          return true;
        }
        
        // Check if code has been used in any enrollment
        const usedEnrollment = await enrollmentRepo.findOne({
          where: { access_code_used: code },
        });
        
        return !!usedEnrollment;
      };

      while (await isCodeUsed(accessCode)) {
        accessCode = generateUniqueCode();
      }

      // Add code to course's available access codes
      if (!course.access_codes) {
        course.access_codes = [];
      }
      course.access_codes.push(accessCode);
      await courseRepo.save(course);

      // Update enrollment request if it exists - mark as sent but DO NOT set access_code_used
      if (enrollmentRequest) {
        enrollmentRequest.access_code_sent = true;
        enrollmentRequest.access_code_sent_at = new Date();
        // IMPORTANT: Do NOT set access_code_used here - that's only set on redemption
        enrollmentRequest.approved_by_user_id = adminId;
        enrollmentRequest.approval_date = new Date();
        await enrollmentRepo.save(enrollmentRequest);
      } else {
        // Create a record of this access code being sent
        const newEnrollment = enrollmentRepo.create({
          user_id: targetUserId,
          course_id: targetCourseId,
          status: EnrollmentStatus.PENDING,
          approval_status: EnrollmentApprovalStatus.PENDING,
          request_type: EnrollmentRequestType.ACCESS_CODE_REQUEST,
          access_code_sent: true,
          access_code_sent_at: new Date(),
          // IMPORTANT: Do NOT set access_code_used here
          approved_by_user_id: adminId,
          approval_date: new Date(),
          institution_id: course.institution_id,
        });
        await enrollmentRepo.save(newEnrollment);
      }

      // Create or update access code request record
      const existingAccessRequest = await accessCodeRequestRepo.findOne({
        where: {
          user_id: targetUserId,
          course_id: targetCourseId,
        },
        order: { requested_at: "DESC" },
      });

      if (existingAccessRequest) {
        existingAccessRequest.generated_code = accessCode;
        existingAccessRequest.status = AccessCodeRequestStatus.CODE_SENT;
        existingAccessRequest.code_sent_at = new Date();
        existingAccessRequest.processed_by_admin_id = adminId;
        existingAccessRequest.processed_at = new Date();
        await accessCodeRequestRepo.save(existingAccessRequest);
      } else {
        const accessCodeRequest = accessCodeRequestRepo.create({
          user_id: targetUserId,
          course_id: targetCourseId,
          institution_id: course.institution_id,
          generated_code: accessCode,
          status: AccessCodeRequestStatus.CODE_SENT,
          code_sent_at: new Date(),
          processed_by_admin_id: adminId,
          processed_at: new Date(),
        });
        await accessCodeRequestRepo.save(accessCodeRequest);
      }

      // Send email to learner with the access code
      await sendEmail({
        to: user.email,
        subject: `Your Access Code for ${course.title}`,
        html: `
          <h2>Access Code Request Approved</h2>
          <p>Hello ${user.first_name || 'Learner'},</p>
          <p>Your request for an access code for the course <strong>${course.title}</strong> has been approved.</p>
          <div style="background-color: #f0f0f0; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <h3 style="margin: 0; color: #333;">Your Access Code</h3>
            <p style="font-size: 32px; font-weight: bold; color: #4CAF50; margin: 10px 0;">${accessCode}</p>
          </div>
          <p>To enroll in the course:</p>
          <ol>
            <li>Go to the course page: <a href="${process.env.CLIENT_URL}/courses/${course.id}">${course.title}</a></li>
            <li>Enter the access code in the provided field</li>
            <li>Click "Verify & Enroll" to gain immediate access</li>
          </ol>
          <p>This code is for your personal use only and should not be shared.</p>
          <p>Happy learning!</p>
          <hr>
          <p><a href="${process.env.CLIENT_URL}/courses/${course.id}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Course</a></p>
        `,
      });

      // Notify admin that code was sent
      const admin = await userRepo.findOne({ where: { id: adminId } });
      if (admin) {
        await sendEmail({
          to: admin.email,
          subject: `Access Code Sent to ${user.email}`,
          html: `
            <h2>Access Code Sent Successfully</h2>
            <p>You have successfully sent an access code to <strong>${user.email}</strong> for the course:</p>
            <p><strong>Course:</strong> ${course.title}</p>
            <p><strong>Access Code:</strong> ${accessCode}</p>
            <p>The learner has been notified via email.</p>
            <p>The code will remain in the available pool until it is redeemed by the learner.</p>
          `,
        });
      }

      res.json({
        success: true,
        message: `Access code sent to ${user.email}`,
        data: {
          access_code: accessCode,
          user_email: user.email,
          course_title: course.title,
          code_sent_at: new Date(),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to send access code",
        error: error.message,
      });
    }
  }

  static async checkEnrollmentScenario(req: Request, res: Response) {
    try {
      const { course_id } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      const course = await courseRepo.findOne({
        where: { id: course_id },
        relations: ["institution"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if already enrolled
      const existingEnrollment = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id },
      });

      const enrollmentData = existingEnrollment ? {
        id: existingEnrollment.id,
        status: existingEnrollment.status,
        approval_status: existingEnrollment.approval_status,
        enrolled_at: existingEnrollment.enrolled_at,
        progress_percentage: existingEnrollment.progress_percentage,
        access_code_sent: existingEnrollment.access_code_sent,
        request_type: existingEnrollment.request_type,
      } : null;

      // Determine scenario
      let scenario_type: string;
      let requires_membership = false;
      let is_member = false;
      let has_pending_request = false;
      let has_code_sent = false;

      // Check membership if course has institution
      if (course.institution_id) {
        const membership = await memberRepo.findOne({
          where: {
            user_id: userId,
            institution_id: course.institution_id,
            is_active: true,
          },
        });
        is_member = !!membership;
      }

      // Check for pending requests
      if (existingEnrollment) {
        has_pending_request = existingEnrollment.status === EnrollmentStatus.PENDING && 
                             existingEnrollment.approval_status === EnrollmentApprovalStatus.PENDING;
        has_code_sent = existingEnrollment.access_code_sent === true;
      }

      if (course.course_type === CourseType.MOOC) {
        if (!course.institution_id) {
          // Scenario 1: Public MOOC Course (No Institution)
          scenario_type = existingEnrollment ? "ALREADY_ENROLLED" : "DIRECT_ENROLL";
        } else {
          // Scenario 3: Institution MOOC Course
          if (!is_member) {
            scenario_type = "REQUIRES_MEMBERSHIP";
            requires_membership = true;
          } else {
            scenario_type = existingEnrollment ? "ALREADY_ENROLLED" : "DIRECT_ENROLL";
          }
        }
      } else { // SPOC
        if (!course.institution_id) {
          // Scenario 2: Public SPOC Course (No Institution)
          if (existingEnrollment) {
            if (existingEnrollment.status === EnrollmentStatus.ACTIVE) {
              scenario_type = "ALREADY_ENROLLED";
            } else if (has_pending_request && has_code_sent) {
              scenario_type = "PENDING_ACCESS_CODE_REQUEST";
            } else if (has_pending_request && !has_code_sent) {
              scenario_type = "REQUEST_ACCESS_CODE";
            } else {
              scenario_type = "REQUEST_ACCESS_CODE";
            }
          } else {
            scenario_type = "REQUEST_ACCESS_CODE";
          }
        } else {
          // Scenario 4: Institution SPOC Course
          if (!is_member) {
            scenario_type = "BLOCKED";
          } else {
            if (existingEnrollment) {
              if (existingEnrollment.status === EnrollmentStatus.ACTIVE) {
                scenario_type = "ALREADY_ENROLLED";
              } else if (has_pending_request && has_code_sent) {
                scenario_type = "PENDING_ACCESS_CODE_REQUEST";
              } else if (has_pending_request && !has_code_sent) {
                scenario_type = "REQUEST_ACCESS_CODE";
              } else {
                scenario_type = "REQUEST_ACCESS_CODE";
              }
            } else {
              scenario_type = "REQUEST_ACCESS_CODE";
            }
          }
        }
      }

      // Check if course has available access codes
      const hasAvailableCodes = course.access_codes && course.access_codes.length > 0;

      // Build response with clear instructions for frontend
      const response = {
        scenario_type,
        course: {
          id: course.id,
          title: course.title,
          course_type: course.course_type,
          has_institution: !!course.institution_id,
          institution_id: course.institution_id,
          institution_name: course.institution?.name,
          has_available_codes: hasAvailableCodes,
        },
        user: {
          id: user.id,
          is_member,
          has_pending_request,
          has_code_sent,
        },
        enrollment: enrollmentData,
        actions: {
          can_enroll_direct: scenario_type === "DIRECT_ENROLL",
          can_request_access_code: scenario_type === "REQUEST_ACCESS_CODE",
          can_redeem_code: scenario_type === "PENDING_ACCESS_CODE_REQUEST",
          requires_membership: scenario_type === "REQUIRES_MEMBERSHIP",
          blocked: scenario_type === "BLOCKED",
        },
        messages: {
          main: getScenarioMessage(scenario_type, course),
          detail: getScenarioDetail(scenario_type, course, is_member, has_code_sent),
        },
      };

      res.json({
        success: true,
        data: response,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to check enrollment scenario",
        error: error.message,
      });
    }
  }


  
static async exportEnrollments(req: Request, res: Response) {
  try {
    const {
      institution_id,
      format = 'csv',
      course_id,
      start_date,
      end_date,
      status,
      fields,
    } = req.query;

    if (!institution_id) {
      return res.status(400).json({
        success: false,
        message: "Institution ID is required",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    
    // Build query
    let queryBuilder = enrollmentRepo
      .createQueryBuilder("enrollment")
      .leftJoinAndSelect("enrollment.user", "user")
      .leftJoinAndSelect("enrollment.course", "course")
      .where("enrollment.institution_id = :institution_id", { institution_id });

    if (course_id) {
      queryBuilder.andWhere("enrollment.course_id = :course_id", { course_id });
    }

    if (start_date) {
      queryBuilder.andWhere("enrollment.enrolled_at >= :start_date", { start_date });
    }

    if (end_date) {
      queryBuilder.andWhere("enrollment.enrolled_at <= :end_date", { end_date });
    }

    if (status) {
      const statuses = (status as string).split(',');
      queryBuilder.andWhere("enrollment.status IN (:...statuses)", { statuses });
    }

    queryBuilder.orderBy("enrollment.enrolled_at", "DESC");

    const enrollments = await queryBuilder.getMany();

    // Parse field selection
    let includeFields = {
      studentInfo: true,
      courseInfo: true,
      enrollmentDetails: true,
      progressData: true,
      certificates: true,
    };

    if (fields) {
      try {
        includeFields = JSON.parse(fields as string);
      } catch (e) {
      }
    }

    // Transform data based on field selection
    const transformedData = enrollments.map(e => {
      const record: any = {};

      if (includeFields.studentInfo) {
        record.student_id = e.user.id;
        record.student_email = e.user.email;
        record.student_first_name = e.user.first_name;
        record.student_last_name = e.user.last_name;
        record.student_username = e.user.username;
        record.student_phone = e.user.phone_number;
        record.student_country = e.user.country;
        record.student_city = e.user.city;
      }

      if (includeFields.courseInfo) {
        record.course_id = e.course.id;
        record.course_title = e.course.title;
        record.course_type = e.course.course_type;
        record.course_instructor = e.course.instructor_id;
        record.course_level = e.course.level;
        record.course_duration_minutes = e.course.duration_minutes;
      }

      if (includeFields.enrollmentDetails) {
        record.enrollment_id = e.id;
        record.enrolled_at = e.enrolled_at;
        record.status = e.status;
        record.approval_status = e.approval_status;
        record.request_type = e.request_type;
        record.access_code_used = e.access_code_used;
        record.requires_approval = e.requires_approval;
        record.approved_by = e.approved_by_user_id;
        record.approval_date = e.approval_date;
      }

      if (includeFields.progressData) {
        record.progress_percentage = e.progress_percentage;
        record.total_time_spent_minutes = e.total_time_spent_minutes;
        record.completed_lessons = e.completed_lessons;
        record.last_accessed = e.last_accessed;
        record.final_score = e.final_score;
      }

      if (includeFields.certificates) {
        record.certificate_issued = e.certificate_issued;
        record.completion_date = e.completion_date;
      }

      return record;
    });

    // Handle different export formats
    if (format === 'csv') {
      if (transformedData.length === 0) {
        return res.send("No data to export");
      }

      const headers = Object.keys(transformedData[0]);
      const csvRows = [
        headers.join(','),
        ...transformedData.map(row => 
          headers.map(header => {
            const value = row[header];
            if (value instanceof Date) {
              return `"${value.toISOString()}"`;
            }
            if (typeof value === 'string') {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return `"${value}"`;
          }).join(',')
        ),
      ];

      const csvContent = csvRows.join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=enrollments_${format(new Date(), 'yyyy-MM-dd')}.csv`);
      return res.send(csvContent);
    }

    if (format === 'excel') {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(transformedData);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Enrollments');
      
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=enrollments_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
      return res.send(buffer);
    }

    // Default JSON
    res.json({
      success: true,
      data: transformedData,
      meta: {
        total: transformedData.length,
        exported_at: new Date(),
        format: 'json',
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to export enrollments",
      error: error.message,
    });
  }
}

static async getExportPreview(req: Request, res: Response) {
  try {
    const {
      institution_id,
      course_id,
      status,
      limit = 10,
    } = req.query;

    if (!institution_id) {
      return res.status(400).json({
        success: false,
        message: "Institution ID is required",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    
    let queryBuilder = enrollmentRepo
      .createQueryBuilder("enrollment")
      .leftJoinAndSelect("enrollment.user", "user")
      .leftJoinAndSelect("enrollment.course", "course")
      .where("enrollment.institution_id = :institution_id", { institution_id })
      .orderBy("enrollment.enrolled_at", "DESC")
      .limit(Number(limit));

    if (course_id) {
      queryBuilder.andWhere("enrollment.course_id = :course_id", { course_id });
    }

    if (status) {
      const statuses = (status as string).split(',');
      queryBuilder.andWhere("enrollment.status IN (:...statuses)", { statuses });
    }

    const enrollments = await queryBuilder.getMany();

    // Return sanitized preview data
    const preview = enrollments.map(e => ({
      user: {
        id: e.user.id,
        email: e.user.email,
        first_name: e.user.first_name,
        last_name: e.user.last_name,
      },
      course: {
        id: e.course.id,
        title: e.course.title,
        course_type: e.course.course_type,
      },
      status: e.status,
      enrolled_at: e.enrolled_at,
      progress_percentage: e.progress_percentage,
      completed_lessons: e.completed_lessons,
    }));

    res.json({
      success: true,
      data: preview,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to get export preview",
      error: error.message,
    });
  }
}

static async getExportHistory(req: Request, res: Response) {
  try {
    const { institution_id } = req.query;

    if (!institution_id) {
      return res.status(400).json({
        success: false,
        message: "Institution ID is required",
      });
    }

    // This would typically come from an export_logs table
    // For now, return mock data
    const mockHistory = [
      {
        filename: `enrollments_${format(subDays(new Date(), 1), 'yyyy-MM-dd')}.csv`,
        record_count: 1250,
        exported_at: subDays(new Date(), 1),
        download_url: '#',
      },
      {
        filename: `enrollments_${format(subDays(new Date(), 7), 'yyyy-MM-dd')}.xlsx`,
        record_count: 3450,
        exported_at: subDays(new Date(), 7),
        download_url: '#',
      },
    ];

    res.json({
      success: true,
      data: mockHistory,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to get export history",
      error: error.message,
    });
  }
}

static async bulkEnrollStudents(req: Request, res: Response) {
  try {
    const { course_id, student_emails, send_notifications = true } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!course_id || !Array.isArray(student_emails)) {
      return res.status(400).json({
        success: false,
        message: "Course ID and student emails array are required",
      });
    }

    const courseRepo = dbConnection.getRepository(Course);
    const userRepo = dbConnection.getRepository(User);
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const memberRepo = dbConnection.getRepository(InstitutionMember);

    const course = await courseRepo.findOne({ 
      where: { id: course_id },
      relations: ["institution", "instructor"]
    });
    
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    // ==================== PERMISSION CHECK ====================
    const user = await userRepo.findOne({ where: { id: userId } });

    const isAuthorized = 
      user?.bwenge_role === BwengeRole.SYSTEM_ADMIN ||
      (user?.bwenge_role === BwengeRole.INSTITUTION_ADMIN && 
       course.institution_id === user.primary_institution_id) ||
      course.instructor_id === userId;

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to enroll students in this course"
      });
    }

    const results = {
      successful: [] as { email: string; enrollment_id: string; access_code?: string }[],
      failed: [] as { email: string; reason: string }[],
      total_successful: 0,
      total_failed: 0,
    };

    for (const email of student_emails) {
      try {
        // Find or create user
        let student = await userRepo.findOne({ where: { email } });

        if (!student) {
          // Generate random password for new user
          const tempPassword = randomBytes(8).toString('hex');
          
          student = userRepo.create({
            email,
            password_hash: await bcrypt.hash(tempPassword, 10),
            first_name: email.split('@')[0],
            username: email.split('@')[0] + Math.floor(Math.random() * 1000),
            bwenge_role: BwengeRole.LEARNER,
            is_verified: false,
            is_active: true,
          });
          await userRepo.save(student);

          // Send welcome email with temp password
          if (send_notifications) {
            await sendEmail({
              to: email,
              subject: `Welcome to ${course.title}`,
              html: `
                <h2>Welcome to the Course!</h2>
                <p>You have been enrolled in <strong>${course.title}</strong>.</p>
                <p>Your temporary password is: <strong>${tempPassword}</strong></p>
                <p>Please log in at ${process.env.CLIENT_URL}/login to access your course.</p>
                <p>We recommend changing your password after your first login.</p>
              `,
            });
          }
        }

        // Check if already enrolled
        const existing = await enrollmentRepo.findOne({
          where: { user_id: student.id, course_id },
        });

        if (existing) {
          if (existing.status === EnrollmentStatus.ACTIVE) {
            results.failed.push({ email, reason: "Already enrolled" });
            continue;
          } else {
            // Update existing enrollment to active
            existing.status = EnrollmentStatus.ACTIVE;
            existing.approval_status = EnrollmentApprovalStatus.APPROVED;
            existing.enrolled_at = new Date();
            await enrollmentRepo.save(existing);
            
            results.successful.push({ 
              email, 
              enrollment_id: existing.id 
            });
            
            // Send notification
            if (send_notifications) {
              await sendEmail({
                to: email,
                subject: `Enrolled in ${course.title}`,
                html: `
                  <h2>Enrollment Successful!</h2>
                  <p>You have been enrolled in <strong>${course.title}</strong>.</p>
                  <p>Start learning at ${process.env.CLIENT_URL}/courses/${course.id}/learn</p>
                `,
              });
            }
            
            results.total_successful++;
            continue;
          }
        }

        // For SPOC courses, generate and assign an access code if needed
        let accessCode: string | undefined;
        if (course.course_type === CourseType.SPOC) {
          if (course.access_codes && course.access_codes.length > 0) {
            // Use an existing code
            accessCode = course.access_codes.shift();
          } else {
            // Generate new code
            accessCode = randomBytes(6).toString('hex').toUpperCase();
            if (!course.access_codes) course.access_codes = [];
            course.access_codes.push(accessCode);
          }
        }

        // Check institution membership if required
        if (course.institution_id && course.requires_approval) {
          const membership = await memberRepo.findOne({
            where: {
              user_id: student.id,
              institution_id: course.institution_id,
              is_active: true,
            },
          });

          if (!membership && course.requires_approval) {
            // Create pending enrollment requiring approval
            const pendingEnrollment = enrollmentRepo.create({
              user_id: student.id,
              course_id,
              status: EnrollmentStatus.PENDING,
              approval_status: EnrollmentApprovalStatus.PENDING,
              request_type: EnrollmentRequestType.APPROVAL_REQUEST,
              institution_id: course.institution_id,
              requires_approval: true,
            });
            await enrollmentRepo.save(pendingEnrollment);
            
            results.failed.push({ 
              email, 
              reason: "Institution membership required - pending approval" 
            });
            continue;
          }
        }

        // Create active enrollment
        const enrollment = enrollmentRepo.create({
          user_id: student.id,
          course_id,
          status: EnrollmentStatus.ACTIVE,
          approval_status: EnrollmentApprovalStatus.APPROVED,
          access_code_used: accessCode,
          institution_id: course.institution_id,
          enrolled_at: new Date(),
        });

        await enrollmentRepo.save(enrollment);

        // Update course access codes if one was used
        if (accessCode && course.course_type === CourseType.SPOC) {
          await courseRepo.save(course);
        }

        results.successful.push({ 
          email, 
          enrollment_id: enrollment.id,
          access_code: accessCode 
        });
        results.total_successful++;

        // Send notification email
        if (send_notifications) {
          let emailHtml = `
            <h2>Enrollment Successful!</h2>
            <p>You have been enrolled in <strong>${course.title}</strong>.</p>
            <p>Start learning at ${process.env.CLIENT_URL}/courses/${course.id}/learn</p>
          `;

          if (accessCode) {
            emailHtml = `
              <h2>Enrollment Successful!</h2>
              <p>You have been enrolled in <strong>${course.title}</strong>.</p>
              <div style="background-color: #f0f0f0; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                <h3 style="margin: 0; color: #333;">Your Access Code</h3>
                <p style="font-size: 32px; font-weight: bold; color: #4CAF50; margin: 10px 0;">${accessCode}</p>
              </div>
              <p>Use this code when accessing the course.</p>
              <p><a href="${process.env.CLIENT_URL}/courses/${course.id}/learn" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Start Learning</a></p>
            `;
          }

          await sendEmail({
            to: email,
            subject: `Enrolled in ${course.title}`,
            html: emailHtml,
          });
        }
      } catch (err: any) {
        results.failed.push({ email, reason: err.message });
        results.total_failed++;
      }
    }

    // Update course enrollment count
    course.enrollment_count = (course.enrollment_count || 0) + results.total_successful;
    await courseRepo.save(course);

    // Send in-app notification to institution admins about bulk enrollment
    if (course.institution_id && results.total_successful > 0) {
      NotificationService.onBulkEnrollmentCompleted(
        course.institution_id,
        course.title,
        results.total_successful,
        course.id,
        userId
      ).catch(() => {});
    }

    res.json({
      success: true,
      message: `Bulk enrollment completed: ${results.total_successful} successful, ${results.total_failed} failed`,
      data: results,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to bulk enroll students",
      error: error.message,
    });
  }
}
static async getInstitutionEnrollmentAnalytics(req: Request, res: Response) {
  try {
    const { institutionId } = req.params;
    const { start_date, end_date, course_id } = req.query;
    const userId = req.user?.userId || req.user?.id;

    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: "Institution ID is required",
      });
    }

    // Verify user has access
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    
    const hasAccess = 
      user?.bwenge_role === "SYSTEM_ADMIN" ||
      (user?.bwenge_role === "INSTITUTION_ADMIN" && 
       user.primary_institution_id === institutionId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this institution's analytics",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const courseRepo = dbConnection.getRepository(Course);
    const userStatsRepo = dbConnection.getRepository(User);

    // Base query
    let queryBuilder = enrollmentRepo
      .createQueryBuilder("enrollment")
      .leftJoinAndSelect("enrollment.course", "course")
      .leftJoinAndSelect("enrollment.user", "user")
      .where("enrollment.institution_id = :institutionId", { institutionId });

    // Apply date filter
    if (start_date) {
      queryBuilder.andWhere("enrollment.enrolled_at >= :start_date", { start_date });
    }
    if (end_date) {
      queryBuilder.andWhere("enrollment.enrolled_at <= :end_date", { end_date });
    }

    // Apply course filter
    if (course_id) {
      queryBuilder.andWhere("enrollment.course_id = :course_id", { course_id });
    }

    const enrollments = await queryBuilder.getMany();

    // Calculate statistics
    const total_enrollments = enrollments.length;
    const active_enrollments = enrollments.filter(e => e.status === "ACTIVE").length;
    const completed_enrollments = enrollments.filter(e => e.status === "COMPLETED").length;
    const dropped_enrollments = enrollments.filter(e => e.status === "DROPPED").length;
    const pending_enrollments = enrollments.filter(e => e.status === "PENDING").length;

    // Calculate conversion rate
    const total_requests = enrollments.filter(e => 
      e.request_type === "APPROVAL_REQUEST" || e.request_type === "ACCESS_CODE_REQUEST"
    ).length;
    const approved_requests = enrollments.filter(e => 
      e.approval_status === "APPROVED" && e.status === "ACTIVE"
    ).length;
    const conversion_rate = total_requests > 0 ? approved_requests / total_requests : 0;

    // Calculate average completion time
    const completedEnrollments = enrollments.filter(e => 
      e.status === "COMPLETED" && e.completion_date && e.enrolled_at
    );
    const completionTimes = completedEnrollments.map(e => {
      const diffTime = Math.abs(e.completion_date!.getTime() - e.enrolled_at.getTime());
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // days
    });
    const average_completion_time = completionTimes.length > 0
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      : 0;

    // Get total students
    const total_students = await userStatsRepo.count({
      where: {
        is_institution_member: true,
        institution_ids: institutionId,
      },
    });

    // Students with multiple enrollments
    const studentEnrollmentCounts = new Map();
    enrollments.forEach(e => {
      const count = studentEnrollmentCounts.get(e.user_id) || 0;
      studentEnrollmentCounts.set(e.user_id, count + 1);
    });
    const students_with_multiple_enrollments = Array.from(studentEnrollmentCounts.values())
      .filter(count => count > 1).length;

    // Group by course
    const courseMap = new Map();
    for (const enrollment of enrollments) {
      const courseId = enrollment.course_id;
      if (!courseMap.has(courseId)) {
        const course = await courseRepo.findOne({ where: { id: courseId } });
        courseMap.set(courseId, {
          course_id: courseId,
          course_title: course?.title || "Unknown",
          course_type: course?.course_type || "UNKNOWN",
          enrollment_count: 0,
          completion_count: 0,
          progress_sum: 0,
          progress_count: 0,
        });
      }
      
      const courseData = courseMap.get(courseId);
      courseData.enrollment_count++;
      
      if (enrollment.status === "COMPLETED") {
        courseData.completion_count++;
      }
      
      courseData.progress_sum += enrollment.progress_percentage;
      courseData.progress_count++;
    }

    const by_course = Array.from(courseMap.values()).map(course => ({
      ...course,
      completion_rate: course.enrollment_count > 0 
        ? course.completion_count / course.enrollment_count 
        : 0,
      average_progress: course.progress_count > 0 
        ? course.progress_sum / course.progress_count 
        : 0,
    }));

    // Group by month
    const monthMap = new Map();
    enrollments.forEach(e => {
      const month = format(e.enrolled_at, "yyyy-MM");
      if (!monthMap.has(month)) {
        monthMap.set(month, { enrollments: 0, completions: 0 });
      }
      monthMap.get(month).enrollments++;
      
      if (e.status === "COMPLETED" && e.completion_date) {
        const completionMonth = format(e.completion_date, "yyyy-MM");
        if (!monthMap.has(completionMonth)) {
          monthMap.set(completionMonth, { enrollments: 0, completions: 0 });
        }
        monthMap.get(completionMonth).completions++;
      }
    });

    const by_month = Array.from(monthMap.entries())
      .map(([month, counts]) => ({
        month,
        enrollments: counts.enrollments,
        completions: counts.completions,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Group by status
    const statusCounts = {
      ACTIVE: active_enrollments,
      COMPLETED: completed_enrollments,
      DROPPED: dropped_enrollments,
      PENDING: pending_enrollments,
    };
    
    const by_status = Object.entries(statusCounts)
      .filter(([_, count]) => count > 0)
      .map(([status, count]) => ({ status, count }));

    // Group by course type
    const typeCounts = {
      MOOC: enrollments.filter(e => e.course?.course_type === "MOOC").length,
      SPOC: enrollments.filter(e => e.course?.course_type === "SPOC").length,
    };
    
    const by_course_type = Object.entries(typeCounts)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => ({ type, count }));

    // Top courses
    const top_courses = by_course
      .sort((a, b) => b.enrollment_count - a.enrollment_count)
      .slice(0, 5)
      .map(c => ({
        course_id: c.course_id,
        course_title: c.course_title,
        enrollment_count: c.enrollment_count,
      }));

    // Calculate growth rates
    const enrollment_growth = {
      daily: calculateGrowthRate(by_month, 1),
      weekly: calculateGrowthRate(by_month, 7),
      monthly: calculateGrowthRate(by_month, 30),
      yearly: calculateGrowthRate(by_month, 365),
    };

    res.json({
      success: true,
      data: {
        total_enrollments,
        active_enrollments,
        completed_enrollments,
        dropped_enrollments,
        pending_enrollments,
        conversion_rate,
        average_completion_time,
        total_students,
        students_with_multiple_enrollments,
        enrollment_growth,
        by_course,
        by_month,
        by_status,
        by_course_type,
        top_courses,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch enrollment analytics",
      error: error.message,
    });
  }
}


// Add this method to EnhancedEnrollmentController class
static async getEnrollmentCount(req: Request, res: Response) {
  try {
    const { institution_id, course_id, start_date, end_date, status } = req.query;
    const userId = req.user?.userId || req.user?.id;

    if (!institution_id) {
      return res.status(400).json({
        success: false,
        message: "Institution ID is required",
      });
    }

    // Verify user has access
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    
    const hasAccess = 
      user?.bwenge_role === "SYSTEM_ADMIN" ||
      (user?.bwenge_role === "INSTITUTION_ADMIN" && 
       user.primary_institution_id === institution_id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this institution's enrollment data",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    
    // Build query
    let queryBuilder = enrollmentRepo
      .createQueryBuilder("enrollment")
      .where("enrollment.institution_id = :institution_id", { institution_id });

    if (course_id) {
      queryBuilder.andWhere("enrollment.course_id = :course_id", { course_id });
    }

    if (start_date) {
      queryBuilder.andWhere("enrollment.enrolled_at >= :start_date", { start_date });
    }

    if (end_date) {
      queryBuilder.andWhere("enrollment.enrolled_at <= :end_date", { end_date });
    }

    if (status) {
      const statuses = (status as string).split(',');
      queryBuilder.andWhere("enrollment.status IN (:...statuses)", { statuses });
    }

    const count = await queryBuilder.getCount();

    res.json({
      success: true,
      data: {
        count,
        filters: {
          institution_id,
          course_id: course_id || null,
          start_date: start_date || null,
          end_date: end_date || null,
          status: status || null,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to get enrollment count",
      error: error.message,
    });
  }
}

}

function getScenarioMessage(scenario_type: string, course: any): string {
  switch (scenario_type) {
    case "DIRECT_ENROLL":
      return "You can enroll in this course immediately";
    case "REQUEST_ACCESS_CODE":
      return "This course requires an access code";
    case "PENDING_ACCESS_CODE_REQUEST":
      return "Your access code has been sent. Enter it below to enroll.";
    case "ALREADY_ENROLLED":
      return "You are already enrolled in this course";
    case "REQUIRES_MEMBERSHIP":
      return "You must be a member of the institution to enroll";
    case "BLOCKED":
      return "You cannot enroll in this course";
    default:
      return "";
  }
}

function getScenarioDetail(scenario_type: string, course: any, is_member: boolean, has_code_sent: boolean): string {
  switch (scenario_type) {
    case "DIRECT_ENROLL":
      return "Click the button below to start learning immediately";
    case "REQUEST_ACCESS_CODE":
      if (course.institution_id && !is_member) {
        return `You must be a member of ${course.institution?.name || 'the institution'} to request an access code`;
      }
      return "Request an access code from the administrator. You'll receive it by email.";
    case "PENDING_ACCESS_CODE_REQUEST":
      return has_code_sent 
        ? "Your access code has been sent to your email. Enter it below to enroll."
        : "Your request has been submitted. Once approved, you'll receive an access code via email.";
    case "ALREADY_ENROLLED":
      return "Continue your learning journey";
    case "REQUIRES_MEMBERSHIP":
      return `You need to join ${course.institution?.name || 'the institution'} before enrolling in this course`;
    case "BLOCKED":
      return "This course is restricted to institution members only";
    default:
      return "";
  }
}

function calculateGrowthRate(monthlyData: any[], days: number): number {
  if (monthlyData.length < 2) return 0;
  
  const recent = monthlyData.slice(-Math.ceil(days / 30)).reduce((sum, m) => sum + m.enrollments, 0);
  const previous = monthlyData.slice(-Math.ceil(days / 30) * 2, -Math.ceil(days / 30))
    .reduce((sum, m) => sum + m.enrollments, 0);
  
  if (previous === 0) return recent > 0 ? 1 : 0;
  return (recent - previous) / previous;
}