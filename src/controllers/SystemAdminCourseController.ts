// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Course, CourseType, CourseStatus } from "../database/models/Course";
import { User, BwengeRole } from "../database/models/User";
import { Enrollment } from "../database/models/Enrollment";

// ==================== SYSTEM ADMIN COURSE CONTROLLER ====================
// Handles: MOOC Overview, SPOC Overview, Course Reports, Content Moderation

export class SystemAdminCourseController {

  // ==================== PERMISSION GUARD ====================
  private static async verifySystemAdmin(req: Request, res: Response): Promise<boolean> {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return false;
    }
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      res.status(403).json({ success: false, message: "System admin access required" });
      return false;
    }
    return true;
  }

  // ==================== MOOC OVERVIEW ====================
  // GET /courses/admin/mooc-overview
  static async getMOOCOverview(req: Request, res: Response) {
    try {
      if (!(await SystemAdminCourseController.verifySystemAdmin(req, res))) return;

      const {
        page = 1,
        limit = 20,
        status,
        level,
        category_id,
        search,
        sort_by = "created_at",
        sort_dir = "DESC",
      } = req.query;

      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      // Build query for all MOOC courses
      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.institution", "institution")
        .leftJoinAndSelect("course.course_category", "course_category")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .where("course.course_type = :type", { type: CourseType.MOOC });

      if (status) queryBuilder.andWhere("course.status = :status", { status });
      if (level) queryBuilder.andWhere("course.level = :level", { level });
      if (category_id) queryBuilder.andWhere("course.category_id = :category_id", { category_id });
      if (search) {
        queryBuilder.andWhere(
          "(course.title ILIKE :search OR course.description ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      const validSortFields: Record<string, string> = {
        created_at: "course.created_at",
        enrollment_count: "course.enrollment_count",
        average_rating: "course.average_rating",
        title: "course.title",
        total_lessons: "course.total_lessons",
      };
      const sortField = validSortFields[sort_by as string] || "course.created_at";
      const sortDirection = sort_dir === "ASC" ? "ASC" : "DESC";

      const total = await queryBuilder.getCount();
      const courses = await queryBuilder
        .orderBy(sortField, sortDirection)
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // Aggregate stats
      const allMOOCStats = await courseRepo
        .createQueryBuilder("course")
        .select([
          "COUNT(*) AS total",
          "SUM(CASE WHEN course.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published",
          "SUM(CASE WHEN course.status = 'DRAFT' THEN 1 ELSE 0 END) AS draft",
          "SUM(CASE WHEN course.status = 'ARCHIVED' THEN 1 ELSE 0 END) AS archived",
          "SUM(course.enrollment_count) AS total_enrollments",
          "AVG(course.average_rating) AS avg_rating",
          "SUM(course.total_lessons) AS total_lessons",
          "AVG(course.duration_minutes) AS avg_duration",
        ])
        .where("course.course_type = :type", { type: CourseType.MOOC })
        .getRawOne();

      // Level distribution
      const levelDistribution = await courseRepo
        .createQueryBuilder("course")
        .select(["course.level AS level", "COUNT(*) AS count"])
        .where("course.course_type = :type", { type: CourseType.MOOC })
        .groupBy("course.level")
        .getRawMany();

      // Enrollment trend (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const enrollmentTrend = await enrollmentRepo
        .createQueryBuilder("enrollment")
        .select([
          "DATE_TRUNC('month', enrollment.enrolled_at) AS month",
          "COUNT(*) AS count",
        ])
        .innerJoin("enrollment.course", "course")
        .where("course.course_type = :type", { type: CourseType.MOOC })
        .andWhere("enrollment.enrolled_at >= :since", { since: sixMonthsAgo })
        .groupBy("DATE_TRUNC('month', enrollment.enrolled_at)")
        .orderBy("month", "ASC")
        .getRawMany();

      // Top performing MOOC courses
      const topCourses = await courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .where("course.course_type = :type", { type: CourseType.MOOC })
        .andWhere("course.status = :status", { status: CourseStatus.PUBLISHED })
        .orderBy("course.enrollment_count", "DESC")
        .take(5)
        .getMany();

      // Clean courses
      const cleanedCourses = courses.map(c => ({
        id: c.id,
        title: c.title,
        thumbnail_url: c.thumbnail_url,
        course_type: c.course_type,
        status: c.status,
        level: c.level,
        enrollment_count: c.enrollment_count,
        average_rating: c.average_rating,
        total_lessons: c.total_lessons,
        duration_minutes: c.duration_minutes,
        is_public: c.is_public,
        price: c.price,
        is_certificate_available: c.is_certificate_available,
        language: c.language,
        created_at: c.created_at,
        published_at: c.published_at,
        total_modules: c.modules?.length || 0,
        instructor: c.instructor ? {
          id: c.instructor.id,
          first_name: c.instructor.first_name,
          last_name: c.instructor.last_name,
          profile_picture_url: c.instructor.profile_picture_url,
        } : null,
        course_category: c.course_category ? { id: c.course_category.id, name: c.course_category.name } : null,
      }));

      res.json({
        success: true,
        data: {
          overview: {
            total: Number(allMOOCStats?.total || 0),
            published: Number(allMOOCStats?.published || 0),
            draft: Number(allMOOCStats?.draft || 0),
            archived: Number(allMOOCStats?.archived || 0),
            total_enrollments: Number(allMOOCStats?.total_enrollments || 0),
            avg_rating: parseFloat(allMOOCStats?.avg_rating || "0").toFixed(2),
            total_lessons: Number(allMOOCStats?.total_lessons || 0),
            avg_duration_minutes: Math.round(Number(allMOOCStats?.avg_duration || 0)),
          },
          level_distribution: levelDistribution.map(l => ({
            level: l.level,
            count: Number(l.count),
          })),
          enrollment_trend: enrollmentTrend.map(t => ({
            month: t.month,
            count: Number(t.count),
          })),
          top_courses: topCourses.map(c => ({
            id: c.id,
            title: c.title,
            thumbnail_url: c.thumbnail_url,
            enrollment_count: c.enrollment_count,
            average_rating: c.average_rating,
            status: c.status,
            instructor: c.instructor ? {
              id: c.instructor.id,
              first_name: c.instructor.first_name,
              last_name: c.instructor.last_name,
              profile_picture_url: c.instructor.profile_picture_url,
            } : null,
          })),
          courses: cleanedCourses,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ getMOOCOverview error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch MOOC overview", error: error.message });
    }
  }

  // ==================== SPOC OVERVIEW ====================
  // GET /courses/admin/spoc-overview
  static async getSPOCOverview(req: Request, res: Response) {
    try {
      if (!(await SystemAdminCourseController.verifySystemAdmin(req, res))) return;

      const {
        page = 1,
        limit = 20,
        status,
        institution_id,
        search,
        sort_by = "created_at",
        sort_dir = "DESC",
      } = req.query;

      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.institution", "institution")
        .leftJoinAndSelect("course.course_category", "course_category")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .where("course.course_type = :type", { type: CourseType.SPOC });

      if (status) queryBuilder.andWhere("course.status = :status", { status });
      if (institution_id) queryBuilder.andWhere("course.institution_id = :institution_id", { institution_id });
      if (search) {
        queryBuilder.andWhere(
          "(course.title ILIKE :search OR institution.name ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      const validSortFields: Record<string, string> = {
        created_at: "course.created_at",
        enrollment_count: "course.enrollment_count",
        title: "course.title",
      };
      const sortField = validSortFields[sort_by as string] || "course.created_at";
      const sortDirection = sort_dir === "ASC" ? "ASC" : "DESC";

      const total = await queryBuilder.getCount();
      const courses = await queryBuilder
        .orderBy(sortField, sortDirection)
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // Aggregate stats
      const allSPOCStats = await courseRepo
        .createQueryBuilder("course")
        .select([
          "COUNT(*) AS total",
          "SUM(CASE WHEN course.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published",
          "SUM(CASE WHEN course.status = 'DRAFT' THEN 1 ELSE 0 END) AS draft",
          "SUM(CASE WHEN course.status = 'ARCHIVED' THEN 1 ELSE 0 END) AS archived",
          "SUM(course.enrollment_count) AS total_enrollments",
          "COUNT(DISTINCT course.institution_id) AS institution_count",
          "AVG(course.average_rating) AS avg_rating",
        ])
        .where("course.course_type = :type", { type: CourseType.SPOC })
        .getRawOne();

      // Institution breakdown
      const institutionBreakdown = await courseRepo
        .createQueryBuilder("course")
        .leftJoin("course.institution", "institution")
        .select([
          "course.institution_id AS institution_id",
          "institution.name AS institution_name",
          "institution.logo_url AS institution_logo",
          "COUNT(*) AS course_count",
          "SUM(CASE WHEN course.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published_count",
          "SUM(course.enrollment_count) AS total_enrollments",
          "AVG(course.average_rating) AS avg_rating",
        ])
        .where("course.course_type = :type", { type: CourseType.SPOC })
        .andWhere("course.institution_id IS NOT NULL")
        .groupBy("course.institution_id, institution.name, institution.logo_url")
        .orderBy("course_count", "DESC")
        .take(10)
        .getRawMany();

      // Enrollment trend (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const enrollmentTrend = await enrollmentRepo
        .createQueryBuilder("enrollment")
        .select([
          "DATE_TRUNC('month', enrollment.enrolled_at) AS month",
          "COUNT(*) AS count",
        ])
        .innerJoin("enrollment.course", "course")
        .where("course.course_type = :type", { type: CourseType.SPOC })
        .andWhere("enrollment.enrolled_at >= :since", { since: sixMonthsAgo })
        .groupBy("DATE_TRUNC('month', enrollment.enrolled_at)")
        .orderBy("month", "ASC")
        .getRawMany();

      // Clean courses
      const cleanedCourses = courses.map(c => ({
        id: c.id,
        title: c.title,
        thumbnail_url: c.thumbnail_url,
        course_type: c.course_type,
        status: c.status,
        level: c.level,
        enrollment_count: c.enrollment_count,
        max_enrollments: c.max_enrollments,
        average_rating: c.average_rating,
        total_lessons: c.total_lessons,
        duration_minutes: c.duration_minutes,
        requires_approval: c.requires_approval,
        is_institution_wide: c.is_institution_wide,
        is_certificate_available: c.is_certificate_available,
        created_at: c.created_at,
        published_at: c.published_at,
        total_modules: c.modules?.length || 0,
        instructor: c.instructor ? {
          id: c.instructor.id,
          first_name: c.instructor.first_name,
          last_name: c.instructor.last_name,
          profile_picture_url: c.instructor.profile_picture_url,
        } : null,
        institution: c.institution ? {
          id: c.institution.id,
          name: c.institution.name,
          logo_url: c.institution.logo_url,
        } : null,
        course_category: c.course_category ? { id: c.course_category.id, name: c.course_category.name } : null,
      }));

      res.json({
        success: true,
        data: {
          overview: {
            total: Number(allSPOCStats?.total || 0),
            published: Number(allSPOCStats?.published || 0),
            draft: Number(allSPOCStats?.draft || 0),
            archived: Number(allSPOCStats?.archived || 0),
            total_enrollments: Number(allSPOCStats?.total_enrollments || 0),
            institution_count: Number(allSPOCStats?.institution_count || 0),
            avg_rating: parseFloat(allSPOCStats?.avg_rating || "0").toFixed(2),
          },
          institution_breakdown: institutionBreakdown.map(i => ({
            institution_id: i.institution_id,
            institution_name: i.institution_name || "Unknown Institution",
            institution_logo: i.institution_logo,
            course_count: Number(i.course_count),
            published_count: Number(i.published_count),
            total_enrollments: Number(i.total_enrollments || 0),
            avg_rating: parseFloat(i.avg_rating || "0").toFixed(2),
          })),
          enrollment_trend: enrollmentTrend.map(t => ({
            month: t.month,
            count: Number(t.count),
          })),
          courses: cleanedCourses,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ getSPOCOverview error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch SPOC overview", error: error.message });
    }
  }

  // ==================== COURSE REPORTS ====================
  // GET /courses/admin/reports
  static async getCourseReports(req: Request, res: Response) {
    try {
      if (!(await SystemAdminCourseController.verifySystemAdmin(req, res))) return;

      const { start_date, end_date, group_by = "month", export: isExport } = req.query;

      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      const startDate = start_date
        ? new Date(start_date as string)
        : (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; })();
      const endDate = end_date ? new Date(end_date as string) : new Date();

      // Platform-wide totals
      const platformStats = await courseRepo
        .createQueryBuilder("course")
        .select([
          "COUNT(*) AS total_courses",
          "SUM(CASE WHEN course.course_type = 'MOOC' THEN 1 ELSE 0 END) AS total_mooc",
          "SUM(CASE WHEN course.course_type = 'SPOC' THEN 1 ELSE 0 END) AS total_spoc",
          "SUM(CASE WHEN course.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published",
          "SUM(CASE WHEN course.status = 'DRAFT' THEN 1 ELSE 0 END) AS draft",
          "SUM(CASE WHEN course.status = 'ARCHIVED' THEN 1 ELSE 0 END) AS archived",
          "SUM(course.enrollment_count) AS total_enrollments",
          "AVG(course.average_rating) AS avg_rating",
          "SUM(course.total_lessons) AS total_lessons",
          "SUM(course.duration_minutes) AS total_duration_minutes",
          "COUNT(DISTINCT course.institution_id) AS institutions_with_courses",
        ])
        .getRawOne();

      // Enrollment stats
      const enrollmentStats = await enrollmentRepo
        .createQueryBuilder("enrollment")
        .select([
          "COUNT(*) AS total_enrollments",
          "SUM(CASE WHEN enrollment.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active",
          "SUM(CASE WHEN enrollment.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed",
          "SUM(CASE WHEN enrollment.status = 'DROPPED' THEN 1 ELSE 0 END) AS dropped",
          "AVG(enrollment.progress_percentage) AS avg_progress",
          "AVG(enrollment.total_time_spent_minutes) AS avg_time_spent",
        ])
        .getRawOne();

      const dateTrunc = group_by === "week" ? "week" : group_by === "day" ? "day" : "month";

      // New courses over time
      const newCoursesOverTime = await courseRepo
        .createQueryBuilder("course")
        .select([
          `DATE_TRUNC('${dateTrunc}', course.created_at) AS period`,
          "COUNT(*) AS count",
          "SUM(CASE WHEN course.course_type = 'MOOC' THEN 1 ELSE 0 END) AS mooc_count",
          "SUM(CASE WHEN course.course_type = 'SPOC' THEN 1 ELSE 0 END) AS spoc_count",
        ])
        .where("course.created_at BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy(`DATE_TRUNC('${dateTrunc}', course.created_at)`)
        .orderBy("period", "ASC")
        .getRawMany();

      // New enrollments over time
      const newEnrollmentsOverTime = await enrollmentRepo
        .createQueryBuilder("enrollment")
        .select([
          `DATE_TRUNC('${dateTrunc}', enrollment.enrolled_at) AS period`,
          "COUNT(*) AS count",
        ])
        .where("enrollment.enrolled_at BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy(`DATE_TRUNC('${dateTrunc}', enrollment.enrolled_at)`)
        .orderBy("period", "ASC")
        .getRawMany();

      // Top courses by enrollment
      const topCourses = await courseRepo
        .createQueryBuilder("course")
        .leftJoin("course.instructor", "instructor")
        .leftJoin("course.institution", "institution")
        .select([
          "course.id AS id",
          "course.title AS title",
          "course.course_type AS course_type",
          "course.status AS status",
          "course.enrollment_count AS enrollment_count",
          "course.average_rating AS average_rating",
          "course.total_lessons AS total_lessons",
          "course.duration_minutes AS duration_minutes",
          "course.level AS level",
          "institution.name AS institution_name",
          "CONCAT(instructor.first_name, ' ', instructor.last_name) AS instructor_name",
        ])
        .orderBy("course.enrollment_count", "DESC")
        .take(20)
        .getRawMany();

      // Level breakdown
      const levelBreakdown = await courseRepo
        .createQueryBuilder("course")
        .select(["course.level AS level", "COUNT(*) AS count", "SUM(course.enrollment_count) AS enrollments"])
        .groupBy("course.level")
        .getRawMany();

      // Category breakdown
      const categoryBreakdown = await courseRepo
        .createQueryBuilder("course")
        .leftJoin("course.course_category", "category")
        .select([
          "category.name AS category_name",
          "COUNT(*) AS course_count",
          "SUM(course.enrollment_count) AS total_enrollments",
        ])
        .where("course.category_id IS NOT NULL")
        .groupBy("category.name")
        .orderBy("course_count", "DESC")
        .take(10)
        .getRawMany();

      // Export CSV
      if (isExport === "true") {
        const headers = [
          "ID", "Title", "Type", "Status", "Level",
          "Instructor", "Institution", "Enrollment Count",
          "Avg Rating", "Total Lessons", "Duration (min)", "Created At", "Published At"
        ];
        const allCourses = await courseRepo
          .createQueryBuilder("course")
          .leftJoin("course.instructor", "instructor")
          .leftJoin("course.institution", "institution")
          .select([
            "course.id", "course.title", "course.course_type", "course.status",
            "course.level", "course.enrollment_count", "course.average_rating",
            "course.total_lessons", "course.duration_minutes",
            "course.created_at", "course.published_at",
            "CONCAT(instructor.first_name, ' ', instructor.last_name) AS instructor_name",
            "institution.name AS institution_name",
          ])
          .getRawMany();

        const rows = allCourses.map(c => [
          c.course_id, c.course_title, c.course_course_type, c.course_status,
          c.course_level, c.instructor_name || "N/A", c.institution_name || "N/A",
          c.course_enrollment_count, c.course_average_rating, c.course_total_lessons,
          c.course_duration_minutes,
          c.course_created_at ? new Date(c.course_created_at).toISOString().split("T")[0] : "",
          c.course_published_at ? new Date(c.course_published_at).toISOString().split("T")[0] : "",
        ]);

        const csvContent = [
          headers.join(","),
          ...rows.map(row => row.map(cell => `"${cell ?? ""}"`).join(","))
        ].join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=course_reports_${new Date().toISOString().split("T")[0]}.csv`);
        return res.send(csvContent);
      }

      res.json({
        success: true,
        data: {
          period: { start: startDate, end: endDate },
          platform_stats: {
            total_courses: Number(platformStats?.total_courses || 0),
            total_mooc: Number(platformStats?.total_mooc || 0),
            total_spoc: Number(platformStats?.total_spoc || 0),
            published: Number(platformStats?.published || 0),
            draft: Number(platformStats?.draft || 0),
            archived: Number(platformStats?.archived || 0),
            total_enrollments: Number(platformStats?.total_enrollments || 0),
            avg_rating: parseFloat(platformStats?.avg_rating || "0").toFixed(2),
            total_lessons: Number(platformStats?.total_lessons || 0),
            total_duration_hours: Math.round(Number(platformStats?.total_duration_minutes || 0) / 60),
            institutions_with_courses: Number(platformStats?.institutions_with_courses || 0),
          },
          enrollment_stats: {
            total: Number(enrollmentStats?.total_enrollments || 0),
            active: Number(enrollmentStats?.active || 0),
            completed: Number(enrollmentStats?.completed || 0),
            dropped: Number(enrollmentStats?.dropped || 0),
            avg_progress: parseFloat(enrollmentStats?.avg_progress || "0").toFixed(1),
            avg_time_spent_minutes: Math.round(Number(enrollmentStats?.avg_time_spent || 0)),
          },
          courses_over_time: newCoursesOverTime.map(r => ({
            period: r.period,
            count: Number(r.count),
            mooc_count: Number(r.mooc_count),
            spoc_count: Number(r.spoc_count),
          })),
          enrollments_over_time: newEnrollmentsOverTime.map(r => ({
            period: r.period,
            count: Number(r.count),
          })),
          top_courses: topCourses.map(c => ({
            id: c.id,
            title: c.title,
            course_type: c.course_type,
            status: c.status,
            level: c.level,
            enrollment_count: Number(c.enrollment_count || 0),
            average_rating: parseFloat(c.average_rating || "0"),
            total_lessons: Number(c.total_lessons || 0),
            duration_minutes: Number(c.duration_minutes || 0),
            institution_name: c.institution_name,
            instructor_name: c.instructor_name,
          })),
          level_breakdown: levelBreakdown.map(l => ({
            level: l.level,
            count: Number(l.count),
            enrollments: Number(l.enrollments || 0),
          })),
          category_breakdown: categoryBreakdown.map(c => ({
            category_name: c.category_name || "Uncategorized",
            course_count: Number(c.course_count),
            total_enrollments: Number(c.total_enrollments || 0),
          })),
        },
      });
    } catch (error: any) {
      console.error("❌ getCourseReports error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch course reports", error: error.message });
    }
  }

  // ==================== CONTENT MODERATION: LIST ====================
  // GET /courses/admin/moderation
  static async getContentModeration(req: Request, res: Response) {
    try {
      if (!(await SystemAdminCourseController.verifySystemAdmin(req, res))) return;

      const {
        page = 1,
        limit = 20,
        moderation_status = "PENDING_REVIEW",
        course_type,
        search,
      } = req.query;

      const courseRepo = dbConnection.getRepository(Course);

      // Map moderation status to DB status
      let statusFilter: string[];
      switch (moderation_status) {
        case "APPROVED": statusFilter = [CourseStatus.PUBLISHED]; break;
        case "REJECTED": statusFilter = [CourseStatus.ARCHIVED]; break;
        case "ALL": statusFilter = [CourseStatus.DRAFT, CourseStatus.PUBLISHED, CourseStatus.ARCHIVED]; break;
        default: statusFilter = [CourseStatus.DRAFT]; // PENDING_REVIEW
      }

      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.institution", "institution")
        .leftJoinAndSelect("course.course_category", "course_category")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .where("course.status IN (:...statuses)", { statuses: statusFilter });

      if (course_type) queryBuilder.andWhere("course.course_type = :course_type", { course_type });
      if (search) {
        queryBuilder.andWhere(
          "(course.title ILIKE :search OR course.description ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      // For pending review, only show courses that have modules
      if (moderation_status === "PENDING_REVIEW") {
        queryBuilder.andWhere(
          `EXISTS (SELECT 1 FROM modules m WHERE m.course_id = course.id)`
        );
      }

      const total = await queryBuilder.getCount();
      const courses = await queryBuilder
        .orderBy("course.updated_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // Queue stats
      const queueStats = await courseRepo
        .createQueryBuilder("course")
        .select([
          "SUM(CASE WHEN course.status = 'DRAFT' THEN 1 ELSE 0 END) AS pending_review",
          "SUM(CASE WHEN course.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS approved",
          "SUM(CASE WHEN course.status = 'ARCHIVED' THEN 1 ELSE 0 END) AS rejected",
          "COUNT(*) AS total",
        ])
        .getRawOne();

      const cleanedCourses = courses.map(c => ({
        id: c.id,
        title: c.title,
        description: c.description,
        short_description: c.short_description,
        thumbnail_url: c.thumbnail_url,
        course_type: c.course_type,
        status: c.status,
        level: c.level,
        language: c.language,
        tags: c.tags,
        requirements: c.requirements,
        what_you_will_learn: c.what_you_will_learn,
        total_lessons: c.modules?.reduce((s: number, m: any) => s + (m.lessons?.length || 0), 0) || 0,
        total_modules: c.modules?.length || 0,
        duration_minutes: c.duration_minutes,
        is_certificate_available: c.is_certificate_available,
        price: c.price,
        created_at: c.created_at,
        updated_at: c.updated_at,
        published_at: c.published_at,
        moderation_flag: c.status === CourseStatus.DRAFT
          ? "PENDING_REVIEW"
          : c.status === CourseStatus.PUBLISHED
          ? "APPROVED"
          : "REJECTED",
        instructor: c.instructor ? {
          id: c.instructor.id,
          first_name: c.instructor.first_name,
          last_name: c.instructor.last_name,
          email: c.instructor.email,
          profile_picture_url: c.instructor.profile_picture_url,
          bwenge_role: c.instructor.bwenge_role,
        } : null,
        institution: c.institution ? {
          id: c.institution.id,
          name: c.institution.name,
          logo_url: c.institution.logo_url,
        } : null,
        course_category: c.course_category ? { id: c.course_category.id, name: c.course_category.name } : null,
      }));

      res.json({
        success: true,
        data: {
          queue_stats: {
            pending_review: Number(queueStats?.pending_review || 0),
            approved: Number(queueStats?.approved || 0),
            rejected: Number(queueStats?.rejected || 0),
            total: Number(queueStats?.total || 0),
          },
          courses: cleanedCourses,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ getContentModeration error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch moderation queue", error: error.message });
    }
  }

  // ==================== MODERATION: APPROVE ====================
  // PATCH /courses/admin/moderation/:id/approve
  static async approveCourse(req: Request, res: Response) {
    try {
      if (!(await SystemAdminCourseController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id } });

      if (!course) return res.status(404).json({ success: false, message: "Course not found" });
      if (course.status === CourseStatus.PUBLISHED) {
        return res.status(400).json({ success: false, message: "Course is already approved/published" });
      }

      course.status = CourseStatus.PUBLISHED;
      course.published_at = new Date();
      await courseRepo.save(course);

      res.json({
        success: true,
        message: "Course approved and published successfully",
        data: { id: course.id, title: course.title, status: course.status, published_at: course.published_at },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: "Failed to approve course", error: error.message });
    }
  }

  // ==================== MODERATION: REJECT ====================
  // PATCH /courses/admin/moderation/:id/reject
  static async rejectCourse(req: Request, res: Response) {
    try {
      if (!(await SystemAdminCourseController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const { reason } = req.body;
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id } });

      if (!course) return res.status(404).json({ success: false, message: "Course not found" });

      course.status = CourseStatus.ARCHIVED;
      await courseRepo.save(course);

      res.json({
        success: true,
        message: "Course rejected and archived",
        data: { id: course.id, title: course.title, status: course.status, rejection_reason: reason },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: "Failed to reject course", error: error.message });
    }
  }

  // ==================== MODERATION: FLAG PUBLISHED COURSE ====================
  // PATCH /courses/admin/moderation/:id/flag
  static async flagCourse(req: Request, res: Response) {
    try {
      if (!(await SystemAdminCourseController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;
      const { reason } = req.body;
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id } });

      if (!course) return res.status(404).json({ success: false, message: "Course not found" });

      course.status = CourseStatus.DRAFT; // move back to pending review
      await courseRepo.save(course);

      res.json({
        success: true,
        message: "Course flagged and moved to pending review",
        data: { id: course.id, title: course.title, status: course.status, flag_reason: reason },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: "Failed to flag course", error: error.message });
    }
  }
}