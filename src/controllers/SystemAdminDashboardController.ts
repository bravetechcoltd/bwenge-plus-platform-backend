// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Institution } from "../database/models/Institution";
import { Course, CourseStatus, CourseType } from "../database/models/Course";
import { User, BwengeRole } from "../database/models/User";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { InstitutionMember, InstitutionMemberRole } from "../database/models/InstitutionMember";
import { ActivityLog } from "../database/models/ActivityLog";
import { IsNull, Not, In, MoreThanOrEqual } from "typeorm";

export class SystemAdminDashboardController {
  /**
   * GET /api/system-admin/dashboard-summary
   * Single aggregation endpoint returning all data for the admin home page.
   */
  static async getDashboardSummary(req: Request, res: Response) {
    try {
      const institutionRepo = dbConnection.getRepository(Institution);
      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const activityRepo = dbConnection.getRepository(ActivityLog);

      // ── KPI STRIP ──────────────────────────────────────────────
      const [
        totalInstitutions,
        totalActiveCourses,
        totalLearners,
        totalInstructors,
        pendingApprovals,
      ] = await Promise.all([
        institutionRepo.count(),
        courseRepo.count({ where: { status: CourseStatus.PUBLISHED } }),
        userRepo.count({ where: { bwenge_role: BwengeRole.LEARNER, is_active: true } }),
        userRepo.count({
          where: [
            { bwenge_role: BwengeRole.INSTRUCTOR, is_active: true },
            { bwenge_role: BwengeRole.CONTENT_CREATOR, is_active: true },
          ],
        }),
        enrollmentRepo.count({
          where: { approval_status: "PENDING" as any },
        }),
      ]);

      const kpi = {
        total_institutions: totalInstitutions,
        total_active_courses: totalActiveCourses,
        total_learners: totalLearners,
        total_instructors: totalInstructors,
        pending_approvals: pendingApprovals,
      };

      // ── INSTITUTION SUMMARY ────────────────────────────────────
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const activeInstitutions = await institutionRepo.count({ where: { is_active: true } });
      const inactiveInstitutions = await institutionRepo.count({ where: { is_active: false } });

      // Institutions with zero courses
      const institutionsWithCourses = await courseRepo
        .createQueryBuilder("course")
        .select("course.institution_id")
        .where("course.institution_id IS NOT NULL")
        .groupBy("course.institution_id")
        .getRawMany();
      const institutionIdsWithCourses = new Set(
        institutionsWithCourses.map((r: any) => r.course_institution_id)
      );
      const zeroCourseInstitutions = totalInstitutions - institutionIdsWithCourses.size;

      // Institutions with active learners (enrollment in last 30 days)
      const institutionsWithActiveLearners = await enrollmentRepo
        .createQueryBuilder("enrollment")
        .select("enrollment.institution_id")
        .where("enrollment.institution_id IS NOT NULL")
        .andWhere("enrollment.last_accessed >= :since", { since: thirtyDaysAgo })
        .groupBy("enrollment.institution_id")
        .getRawMany();

      const institutionOverview = {
        total: totalInstitutions,
        active: activeInstitutions,
        inactive: inactiveInstitutions,
        zero_courses: zeroCourseInstitutions,
        with_active_learners: institutionsWithActiveLearners.length,
      };

      // Per-institution breakdown list
      const institutions = await institutionRepo.find({ order: { name: "ASC" } });

      // Batch: member counts per institution
      const memberCounts = await memberRepo
        .createQueryBuilder("m")
        .select("m.institution_id", "institution_id")
        .addSelect("COUNT(*)", "total")
        .addSelect(
          `SUM(CASE WHEN m.role = '${InstitutionMemberRole.MEMBER}' THEN 1 ELSE 0 END)`,
          "learners"
        )
        .addSelect(
          `SUM(CASE WHEN m.role IN ('${InstitutionMemberRole.INSTRUCTOR}', '${InstitutionMemberRole.CONTENT_CREATOR}') THEN 1 ELSE 0 END)`,
          "instructors"
        )
        .where("m.is_active = true")
        .groupBy("m.institution_id")
        .getRawMany();

      const memberMap = new Map<string, { total: number; learners: number; instructors: number }>();
      for (const row of memberCounts) {
        memberMap.set(row.institution_id, {
          total: parseInt(row.total, 10),
          learners: parseInt(row.learners, 10),
          instructors: parseInt(row.instructors, 10),
        });
      }

      // Batch: published course counts per institution
      const courseCounts = await courseRepo
        .createQueryBuilder("c")
        .select("c.institution_id", "institution_id")
        .addSelect("COUNT(*)", "published")
        .where("c.institution_id IS NOT NULL")
        .andWhere("c.status = :status", { status: CourseStatus.PUBLISHED })
        .groupBy("c.institution_id")
        .getRawMany();

      const courseCountMap = new Map<string, number>();
      for (const row of courseCounts) {
        courseCountMap.set(row.institution_id, parseInt(row.published, 10));
      }

      // Batch: last enrollment activity per institution
      const lastActivity = await enrollmentRepo
        .createQueryBuilder("e")
        .select("e.institution_id", "institution_id")
        .addSelect("MAX(e.last_accessed)", "last_active")
        .where("e.institution_id IS NOT NULL")
        .groupBy("e.institution_id")
        .getRawMany();

      const lastActivityMap = new Map<string, Date | null>();
      for (const row of lastActivity) {
        lastActivityMap.set(row.institution_id, row.last_active ? new Date(row.last_active) : null);
      }

      const institutionList = institutions.map((inst) => {
        const members = memberMap.get(inst.id) || { total: 0, learners: 0, instructors: 0 };
        const publishedCourses = courseCountMap.get(inst.id) || 0;
        const lastActive = lastActivityMap.get(inst.id);
        const isRecentlyActive = lastActive ? lastActive >= thirtyDaysAgo : false;

        return {
          id: inst.id,
          name: inst.name,
          logo_url: inst.logo_url,
          type: inst.type,
          is_active: inst.is_active,
          member_count: members.total,
          learner_count: members.learners,
          instructor_count: members.instructors,
          published_courses: publishedCourses,
          recently_active: isRecentlyActive,
        };
      });

      // ── COURSE STATUS SUMMARY ──────────────────────────────────
      const [
        totalCourses,
        moocCount,
        spocCount,
        publishedCount,
        draftCount,
        archivedCount,
        institutionLinkedCount,
        nonInstitutionCount,
        nonInstitutionMooc,
        nonInstitutionSpoc,
      ] = await Promise.all([
        courseRepo.count(),
        courseRepo.count({ where: { course_type: CourseType.MOOC } }),
        courseRepo.count({ where: { course_type: CourseType.SPOC } }),
        courseRepo.count({ where: { status: CourseStatus.PUBLISHED } }),
        courseRepo.count({ where: { status: CourseStatus.DRAFT } }),
        courseRepo.count({ where: { status: CourseStatus.ARCHIVED } }),
        courseRepo.count({ where: { institution_id: Not(IsNull()) } }),
        courseRepo.count({ where: { institution_id: IsNull() } }),
        courseRepo.count({ where: { institution_id: IsNull(), course_type: CourseType.MOOC } }),
        courseRepo.count({ where: { institution_id: IsNull(), course_type: CourseType.SPOC } }),
      ]);

      const courseSummary = {
        total: totalCourses,
        type_distribution: {
          mooc: moocCount,
          spoc: spocCount,
          mooc_percentage: totalCourses > 0 ? Math.round((moocCount / totalCourses) * 100) : 0,
          spoc_percentage: totalCourses > 0 ? Math.round((spocCount / totalCourses) * 100) : 0,
        },
        origin_distribution: {
          institution_linked: institutionLinkedCount,
          non_institution: nonInstitutionCount,
        },
        status_breakdown: {
          published: publishedCount,
          draft: draftCount,
          archived: archivedCount,
        },
        non_institution_courses: {
          total: nonInstitutionCount,
          mooc: nonInstitutionMooc,
          spoc: nonInstitutionSpoc,
        },
      };

      // ── RECENT ACTIVITY FEED ───────────────────────────────────
      // Use raw query because the ActivityLog entity column names don't match the
      // actual database columns (action_type, content_type, content_id).
      let activityFeed: any[] = [];
      try {
        const rawActivities = await dbConnection.query(
          `SELECT al.id, al.action_type, al.content_type, al.content_id, al.created_at,
                  u.first_name, u.last_name, u.email
           FROM activity_logs al
           LEFT JOIN users u ON u.id = al.user_id
           ORDER BY al.created_at DESC
           LIMIT 15`
        );

        activityFeed = rawActivities.map((row: any) => {
          const userName = row.first_name || row.last_name
            ? `${row.first_name || ""} ${row.last_name || ""}`.trim()
            : row.email || "System";
          return {
            id: row.id,
            action: row.action_type || "",
            description: formatActivityDescription(row.action_type || "", row.content_type),
            user_name: userName,
            target_type: row.content_type,
            target_id: row.content_id,
            timestamp: row.created_at,
          };
        });
      } catch (activityErr: any) {
        console.warn("Activity feed query failed, returning empty:", activityErr.message);
      }

      // ── USER SUMMARY (bonus useful data) ───────────────────────
      const totalUsers = await userRepo.count({ where: { is_active: true } });

      const userSummary = {
        total_active: totalUsers,
        learners: totalLearners,
        instructors: totalInstructors,
        admins: await userRepo.count({
          where: [
            { bwenge_role: BwengeRole.SYSTEM_ADMIN, is_active: true },
            { bwenge_role: BwengeRole.INSTITUTION_ADMIN, is_active: true },
          ],
        }),
      };

      // ── RESPONSE ───────────────────────────────────────────────
      res.json({
        success: true,
        data: {
          kpi,
          institution_overview: institutionOverview,
          institution_list: institutionList,
          course_summary: courseSummary,
          user_summary: userSummary,
          activity_feed: activityFeed,
          last_updated: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      console.error("Admin dashboard summary error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch admin dashboard summary",
        error: error.message,
      });
    }
  }
}

/** Convert an activity action enum into a readable sentence fragment. */
function formatActivityDescription(action: string, targetType: string | null): string {
  const labels: Record<string, string> = {
    CREATE_ENROLLMENT: "New enrollment created",
    CREATE_COURSE: "New course created",
    PUBLISH_COURSE: "Course published",
    CREATE_USER: "New user registered",
    CREATE_INSTITUTION: "New institution registered",
    UPDATE_COURSE: "Course updated",
    DELETE_COURSE: "Course deleted",
    UPDATE_USER: "User profile updated",
    LOGIN: "User logged in",
    ADD_INSTITUTION_MEMBER: "Member added to institution",
    REMOVE_INSTITUTION_MEMBER: "Member removed from institution",
    UPDATE_MEMBER_ROLE: "Member role updated",
    COMPLETE_ENROLLMENT: "Enrollment completed",
    UPDATE_INSTITUTION: "Institution updated",
    DEACTIVATE_USER: "User deactivated",
    REACTIVATE_USER: "User reactivated",
    UPDATE_USER_ROLE: "User role changed",
  };
  return labels[action] || action.replace(/_/g, " ").toLowerCase();
}
