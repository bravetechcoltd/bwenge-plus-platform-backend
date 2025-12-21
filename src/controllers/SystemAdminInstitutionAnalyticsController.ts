import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Institution, InstitutionType } from "../database/models/Institution";
import { InstitutionMember, InstitutionMemberRole } from "../database/models/InstitutionMember";
import { User } from "../database/models/User";
import { Course, CourseType, CourseStatus } from "../database/models/Course";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { Review } from "../database/models/ReviewModel";
import { In, Between, MoreThanOrEqual, LessThanOrEqual } from "typeorm";
import { format, subDays, subMonths, subYears } from "date-fns";

export class SystemAdminInstitutionAnalyticsController {
  
  // ==================== GET COMPREHENSIVE INSTITUTION ANALYTICS ====================
  static async getInstitutionAnalytics(req: Request, res: Response) {
    try {
      const { start_date, end_date, type } = req.query;

      // Get all institutions
      const institutionRepo = dbConnection.getRepository(Institution);
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const userRepo = dbConnection.getRepository(User);
      const reviewRepo = dbConnection.getRepository(Review);

      // Build institution query with filters
      const institutionQuery = institutionRepo.createQueryBuilder("institution");
      
      if (type && type !== "all") {
        institutionQuery.andWhere("institution.type = :type", { type });
      }

      const institutions = await institutionQuery.getMany();
      const institutionIds = institutions.map(i => i.id);

      // Date filters
      let dateFilter = {};
      if (start_date && end_date) {
        dateFilter = {
          created_at: Between(new Date(start_date as string), new Date(end_date as string)),
        };
      } else if (start_date) {
        dateFilter = {
          created_at: MoreThanOrEqual(new Date(start_date as string)),
        };
      } else if (end_date) {
        dateFilter = {
          created_at: LessThanOrEqual(new Date(end_date as string)),
        };
      }

      // ==================== SUMMARY STATISTICS ====================
      const totalInstitutions = institutions.length;
      const activeInstitutions = institutions.filter(i => i.is_active).length;
      const inactiveInstitutions = totalInstitutions - activeInstitutions;

      // Get all members across all institutions
      const members = await memberRepo.find({
        where: institutionIds.length > 0 ? { institution_id: In(institutionIds) } : {},
        relations: ["user"],
      });

      const totalMembers = members.length;
      const activeMembers = members.filter(m => m.is_active).length;

      // Get all courses across all institutions
      const courses = await courseRepo.find({
        where: institutionIds.length > 0 ? { institution_id: In(institutionIds) } : {},
      });

      const totalCourses = courses.length;
      const publishedCourses = courses.filter(c => c.status === CourseStatus.PUBLISHED).length;
      const draftCourses = courses.filter(c => c.status === CourseStatus.DRAFT).length;
      const archivedCourses = courses.filter(c => c.status === CourseStatus.ARCHIVED).length;

      // Get all enrollments
      const enrollments = await enrollmentRepo.find({
        where: institutionIds.length > 0 ? { institution_id: In(institutionIds) } : {},
      });

      const totalEnrollments = enrollments.length;

      // Calculate average completion rate
      const completedEnrollments = enrollments.filter(e => e.status === EnrollmentStatus.COMPLETED).length;
      const averageCompletionRate = enrollments.length > 0
        ? (completedEnrollments / enrollments.length) * 100
        : 0;

      // Get all reviews
      const reviews = await reviewRepo.find({
        where: institutionIds.length > 0 ? { course_id: In(courses.map(c => c.id)) } : {},
      });

      const totalReviews = reviews.length;
      const averageRating = reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

      // Calculate growth rates
      const now = new Date();
      const oneMonthAgo = subMonths(now, 1);
      
      const institutionsCreatedThisMonth = institutions.filter(i => 
        new Date(i.created_at) >= oneMonthAgo
      ).length;

      const membersAddedThisMonth = members.filter(m => 
        new Date(m.joined_at) >= oneMonthAgo
      ).length;

      const coursesPublishedThisMonth = courses.filter(c => 
        c.published_at && new Date(c.published_at) >= oneMonthAgo
      ).length;

      // ==================== INSTITUTIONS BY TYPE ====================
      const institutionsByType = await Promise.all(
        Object.values(InstitutionType).map(async (type) => {
          const typedInstitutions = institutions.filter(i => i.type === type);
          const typedInstitutionIds = typedInstitutions.map(i => i.id);
          
          const memberCount = members.filter(m => 
            typedInstitutionIds.includes(m.institution_id)
          ).length;
          
          const courseCount = courses.filter(c => 
            typedInstitutionIds.includes(c.institution_id)
          ).length;

          return {
            type,
            count: typedInstitutions.length,
            members: memberCount,
            courses: courseCount,
            color: SystemAdminInstitutionAnalyticsController.getTypeColor(type),
          };
        })
      );

      // ==================== INSTITUTIONS BY STATUS ====================
      const institutionsByStatus = [
        { status: "Active", count: activeInstitutions },
        { status: "Inactive", count: inactiveInstitutions },
      ];

      // ==================== INSTITUTIONS BY SIZE ====================
      const institutionsBySize = [
        { size: "Small (<100 members)", min: 0, max: 100, count: 0 },
        { size: "Medium (100-500 members)", min: 100, max: 500, count: 0 },
        { size: "Large (500-2000 members)", min: 500, max: 2000, count: 0 },
        { size: "Enterprise (>2000 members)", min: 2000, max: Infinity, count: 0 },
      ];

      // Count institutions in each size bracket
      for (const institution of institutions) {
        const memberCount = members.filter(m => m.institution_id === institution.id).length;
        
        for (const bracket of institutionsBySize) {
          if (memberCount >= bracket.min && memberCount < bracket.max) {
            bracket.count++;
            break;
          }
        }
      }

      // ==================== TOP PERFORMING INSTITUTIONS ====================
      const topInstitutions = await Promise.all(
        institutions
          .sort((a, b) => {
            const aMembers = members.filter(m => m.institution_id === a.id).length;
            const bMembers = members.filter(m => m.institution_id === b.id).length;
            return bMembers - aMembers;
          })
          .slice(0, 10)
          .map(async (institution) => {
            const institutionMembers = members.filter(m => m.institution_id === institution.id);
            const institutionCourses = courses.filter(c => c.institution_id === institution.id);
            const institutionEnrollments = enrollments.filter(e => e.institution_id === institution.id);
            const institutionReviews = reviews.filter(r => 
              institutionCourses.some(c => c.id === r.course_id)
            );

            const avgRating = institutionReviews.length > 0
              ? institutionReviews.reduce((sum, r) => sum + r.rating, 0) / institutionReviews.length
              : 0;

            const completedCount = institutionEnrollments.filter(e => e.status === EnrollmentStatus.COMPLETED).length;
            const completionRate = institutionEnrollments.length > 0
              ? (completedCount / institutionEnrollments.length) * 100
              : 0;

            // Calculate growth (new members in last 30 days)
            const newMembersCount = institutionMembers.filter(m => 
              new Date(m.joined_at) >= subDays(now, 30)
            ).length;
            
            const totalMembers = institutionMembers.length;
            const growth = totalMembers > 0 ? (newMembersCount / totalMembers) * 100 : 0;

            return {
              id: institution.id,
              name: institution.name,
              type: institution.type,
              logo_url: institution.logo_url,
              members: totalMembers,
              courses: institutionCourses.length,
              enrollments: institutionEnrollments.length,
              average_rating: avgRating,
              completion_rate: completionRate,
              growth,
              created_at: institution.created_at,
            };
          })
      );

      // ==================== TRENDS OVER TIME ====================
      const days = 30;
      const periods = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = subDays(now, i);
        const nextDate = subDays(now, i - 1);
        periods.push({
          date,
          period: format(date, "MMM d"),
        });
      }

      const institutionsOverTime = periods.map(p => ({
        period: p.period,
        count: institutions.filter(i => new Date(i.created_at) <= p.date).length,
        active: institutions.filter(i => i.is_active && new Date(i.created_at) <= p.date).length,
        new: institutions.filter(i => 
          new Date(i.created_at) >= p.date && 
          new Date(i.created_at) < (p.date.setDate(p.date.getDate() + 1), new Date(p.date))
        ).length,
      }));

      const membersOverTime = periods.map(p => ({
        period: p.period,
        count: members.filter(m => new Date(m.joined_at) <= p.date).length,
      }));

      const coursesOverTime = periods.map(p => ({
        period: p.period,
        count: courses.filter(c => new Date(c.created_at) <= p.date).length,
        mooc: courses.filter(c => c.course_type === CourseType.MOOC && new Date(c.created_at) <= p.date).length,
        spoc: courses.filter(c => c.course_type === CourseType.SPOC && new Date(c.created_at) <= p.date).length,
      }));

      const enrollmentsOverTime = periods.map(p => ({
        period: p.period,
        count: enrollments.filter(e => new Date(e.enrolled_at) <= p.date).length,
      }));

      // ==================== GEOGRAPHICAL DISTRIBUTION ====================
      const users = await userRepo.find({
        where: { id: In(members.map(m => m.user_id)) },
      });

      const countryMap = new Map();
      users.forEach(user => {
        if (user.country) {
          const count = countryMap.get(user.country) || 0;
          countryMap.set(user.country, count + 1);
        }
      });

      const geographicalDistribution = Array.from(countryMap.entries())
        .map(([country, count]) => ({
          country,
          count,
          institutions: members.filter(m => 
            users.find(u => u.id === m.user_id)?.country === country
          ).length,
          members: count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // ==================== ENGAGEMENT METRICS ====================
      const oneDayAgo = subDays(now, 1);
      const oneWeekAgo = subDays(now, 7);

      const dailyActiveMembers = members.filter(m => 
        m.user?.last_login && new Date(m.user.last_login) >= oneDayAgo
      ).length;

      const weeklyActiveMembers = members.filter(m => 
        m.user?.last_login && new Date(m.user.last_login) >= oneWeekAgo
      ).length;

      const monthlyActiveMembers = members.filter(m => 
        m.user?.last_login && new Date(m.user.last_login) >= oneMonthAgo
      ).length;

      const totalTimeSpentMinutes = enrollments.reduce((sum, e) => sum + (e.total_time_spent_minutes || 0), 0);
      const totalTimeSpentHours = totalTimeSpentMinutes / 60;

      const memberEngagementRate = totalMembers > 0
        ? (monthlyActiveMembers / totalMembers) * 100
        : 0;

      const courseEngagementRate = totalCourses > 0
        ? (enrollments.length / totalCourses) * 100
        : 0;

      // ==================== MEMBER METRICS ====================
      const membersByRole = await memberRepo
        .createQueryBuilder("member")
        .select("member.role, COUNT(*) as count")
        .groupBy("member.role")
        .getRawMany();

      const membersByInstitution = await Promise.all(
        institutions.slice(0, 10).map(async (inst) => {
          const count = members.filter(m => m.institution_id === inst.id).length;
          return {
            institution_id: inst.id,
            institution_name: inst.name,
            count,
          };
        })
      );

      const newMembersThisMonth = members.filter(m => 
        new Date(m.joined_at) >= oneMonthAgo
      ).length;

      const returningMembers = members.filter(m => 
        m.user?.last_login && new Date(m.user.last_login) >= oneWeekAgo
      ).length;

      // ==================== RISK METRICS ====================
      const institutionsWithLowEngagement = institutions.filter(inst => {
        const instMembers = members.filter(m => m.institution_id === inst.id);
        const activeInstMembers = instMembers.filter(m => 
          m.user?.last_login && new Date(m.user.last_login) >= oneWeekAgo
        ).length;
        const engagementRate = instMembers.length > 0
          ? (activeInstMembers / instMembers.length) * 100
          : 0;
        return engagementRate < 20;
      }).length;

      const institutionsWithHighDropout = institutions.filter(inst => {
        const instEnrollments = enrollments.filter(e => e.institution_id === inst.id);
        const droppedCount = instEnrollments.filter(e => e.status === "DROPPED").length;
        const dropoutRate = instEnrollments.length > 0
          ? (droppedCount / instEnrollments.length) * 100
          : 0;
        return dropoutRate > 30;
      }).length;

      const institutionsWithLowRatings = institutions.filter(inst => {
        const instCourses = courses.filter(c => c.institution_id === inst.id);
        const instReviews = reviews.filter(r => 
          instCourses.some(c => c.id === r.course_id)
        );
        const avgRating = instReviews.length > 0
          ? instReviews.reduce((sum, r) => sum + r.rating, 0) / instReviews.length
          : 0;
        return avgRating > 0 && avgRating < 3.0;
      }).length;

      // At-risk institutions
      const atRiskInstitutions = await Promise.all(
        institutions
          .filter(inst => {
            const instMembers = members.filter(m => m.institution_id === inst.id);
            const instCourses = courses.filter(c => c.institution_id === inst.id);
            const instEnrollments = enrollments.filter(e => e.institution_id === inst.id);
            
            // Risk factors
            const lowMembers = instMembers.length < 50;
            const fewCourses = instCourses.length < 5;
            const lowEngagement = instMembers.length > 0
              ? (instMembers.filter(m => m.user?.last_login && new Date(m.user.last_login) >= oneWeekAgo).length / instMembers.length) * 100 < 20
              : true;
            const highDropout = instEnrollments.length > 0
              ? (instEnrollments.filter(e => e.status === "DROPPED").length / instEnrollments.length) * 100 > 30
              : false;
            
            return lowMembers || fewCourses || lowEngagement || highDropout;
          })
          .slice(0, 5)
          .map(async (inst) => {
            const instMembers = members.filter(m => m.institution_id === inst.id);
            const instCourses = courses.filter(c => c.institution_id === inst.id);
            const instEnrollments = enrollments.filter(e => e.institution_id === inst.id);
            
            const activeMembers = instMembers.filter(m => 
              m.user?.last_login && new Date(m.user.last_login) >= oneWeekAgo
            ).length;
            
            const engagementRate = instMembers.length > 0
              ? (activeMembers / instMembers.length) * 100
              : 0;

            // Determine risk factors
            const riskFactors = [];
            if (instMembers.length < 50) riskFactors.push("low membership");
            if (instCourses.length < 5) riskFactors.push("few courses");
            if (engagementRate < 20) riskFactors.push("low engagement");
            
            const dropoutRate = instEnrollments.length > 0
              ? (instEnrollments.filter(e => e.status === "DROPPED").length / instEnrollments.length) * 100
              : 0;
            if (dropoutRate > 30) riskFactors.push("high dropout");

            // Determine risk level
            let riskLevel: "low" | "medium" | "high" = "low";
            if (riskFactors.length >= 3) riskLevel = "high";
            else if (riskFactors.length >= 2) riskLevel = "medium";
            else if (riskFactors.length >= 1) riskLevel = "low";

            return {
              id: inst.id,
              name: inst.name,
              risk_level: riskLevel,
              risk_factors: riskFactors,
              members: instMembers.length,
              courses: instCourses.length,
              engagement_rate: engagementRate,
            };
          })
      );

      // ==================== COMPARATIVE ANALYSIS ====================
      const averageMembersPerInstitution = totalInstitutions > 0
        ? Math.round(totalMembers / totalInstitutions)
        : 0;

      const averageCoursesPerInstitution = totalInstitutions > 0
        ? Math.round(totalCourses / totalInstitutions)
        : 0;

      const averageEnrollmentsPerCourse = totalCourses > 0
        ? Math.round(totalEnrollments / totalCourses)
        : 0;

      // Calculate performance scores for top/bottom
      const institutionScores = institutions.map(inst => {
        const instMembers = members.filter(m => m.institution_id === inst.id).length;
        const instCourses = courses.filter(c => c.institution_id === inst.id).length;
        const instEnrollments = enrollments.filter(e => e.institution_id === inst.id).length;
        const instReviews = reviews.filter(r => 
          courses.some(c => c.id === r.course_id && c.institution_id === inst.id)
        );
        const avgRating = instReviews.length > 0
          ? instReviews.reduce((sum, r) => sum + r.rating, 0) / instReviews.length
          : 0;

        // Composite score (normalized)
        const score = (
          (instMembers / (totalMembers / totalInstitutions)) * 0.3 +
          (instCourses / (totalCourses / totalInstitutions)) * 0.3 +
          (avgRating / 5) * 0.2 +
          (instEnrollments / (totalEnrollments / totalInstitutions)) * 0.2
        ) * 100;

        return {
          id: inst.id,
          name: inst.name,
          score,
        };
      }).filter(s => s.score > 0);

      const topPerformingInstitution = institutionScores.length > 0
        ? institutionScores.reduce((a, b) => a.score > b.score ? a : b)
        : null;

      const bottomPerformingInstitution = institutionScores.length > 0
        ? institutionScores.reduce((a, b) => a.score < b.score ? a : b)
        : null;

      const institutionSizeDistribution = institutionsBySize.map(item => ({
        size: item.size,
        count: item.count,
        percentage: totalInstitutions > 0 ? (item.count / totalInstitutions) * 100 : 0,
      }));

      // Calculate growth rates
      const growthRates = SystemAdminInstitutionAnalyticsController.calculateGrowthRates(institutionsOverTime);

      // ==================== FINAL RESPONSE ====================
      res.json({
        success: true,
        data: {
          summary: {
            total_institutions: totalInstitutions,
            active_institutions: activeInstitutions,
            inactive_institutions: inactiveInstitutions,
            total_members: totalMembers,
            total_courses: totalCourses,
            total_enrollments: totalEnrollments,
            average_completion_rate: averageCompletionRate,
            average_rating: averageRating,
            total_reviews: totalReviews,
            growth_rate: growthRates.monthly * 100,
            institutions_created_this_month: institutionsCreatedThisMonth,
            members_added_this_month: membersAddedThisMonth,
            courses_published_this_month: coursesPublishedThisMonth,
          },
          institutions_by_type: institutionsByType,
          institutions_by_status: institutionsByStatus,
          institutions_by_size: institutionsBySize,
          top_institutions: topInstitutions,
          institution_performance: topInstitutions.map(inst => ({
            id: inst.id,
            name: inst.name,
            members: inst.members,
            courses: inst.courses,
            enrollments: inst.enrollments,
            completion_rate: inst.completion_rate,
            average_rating: inst.average_rating,
            efficiency_score: Math.round((inst.completion_rate * inst.average_rating * 10) / 100),
          })),
          trends: {
            institutions_over_time: institutionsOverTime,
            members_over_time: membersOverTime,
            courses_over_time: coursesOverTime,
            enrollments_over_time: enrollmentsOverTime,
            growth_rates: growthRates,
          },
          geographical_distribution: geographicalDistribution,
          engagement_metrics: {
            daily_active_members: dailyActiveMembers,
            weekly_active_members: weeklyActiveMembers,
            monthly_active_members: monthlyActiveMembers,
            average_session_duration: 0, // Would need session tracking
            total_time_spent_hours: totalTimeSpentHours,
            member_engagement_rate: memberEngagementRate,
            course_engagement_rate: courseEngagementRate,
          },
          content_metrics: {
            total_courses: totalCourses,
            published_courses: publishedCourses,
            draft_courses: draftCourses,
            archived_courses: archivedCourses,
            mooc_courses: courses.filter(c => c.course_type === CourseType.MOOC).length,
            spoc_courses: courses.filter(c => c.course_type === CourseType.SPOC).length,
            courses_with_certificates: courses.filter(c => c.is_certificate_available).length,
            average_course_duration: courses.length > 0
              ? courses.reduce((sum, c) => sum + (c.duration_minutes || 0), 0) / courses.length
              : 0,
            total_lessons: courses.reduce((sum, c) => sum + (c.total_lessons || 0), 0),
            total_modules: 0, // Would need module count
          },
          member_metrics: {
            total_members: totalMembers,
            active_members: activeMembers,
            inactive_members: totalMembers - activeMembers,
            members_by_role: membersByRole.map(item => ({
              role: item.member_role,
              count: parseInt(item.count),
            })),
            members_by_institution: membersByInstitution,
            new_members_this_month: newMembersThisMonth,
            returning_members: returningMembers,
          },
          risk_metrics: {
            institutions_with_low_engagement: institutionsWithLowEngagement,
            institutions_with_high_dropout: institutionsWithHighDropout,
            institutions_with_low_ratings: institutionsWithLowRatings,
            inactive_institutions: inactiveInstitutions,
            at_risk_institutions: atRiskInstitutions,
          },
          comparative_analysis: {
            average_members_per_institution: averageMembersPerInstitution,
            average_courses_per_institution: averageCoursesPerInstitution,
            average_enrollments_per_course: averageEnrollmentsPerCourse,
            top_performing_institution: topPerformingInstitution,
            bottom_performing_institution: bottomPerformingInstitution,
            institution_size_distribution: institutionSizeDistribution,
          },
        },
      });

    } catch (error: any) {
      console.error("❌ Get institution analytics error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch institution analytics",
        error: error.message,
      });
    }
  }

  // ==================== EXPORT ANALYTICS ====================
  static async exportInstitutionAnalytics(req: Request, res: Response) {
    try {
      const { start_date, end_date, type, format: exportFormat = "csv" } = req.query;

      // Get analytics data
      const analytics = await this.getAnalyticsData({
        start_date: start_date as string,
        end_date: end_date as string,
        type: type as string,
      });

      if (exportFormat === "csv") {
        const csvData = this.convertToCSV(analytics);
        
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=institution_analytics_${format(new Date(), "yyyy-MM-dd")}.csv`
        );
        return res.send(csvData);
      }

      res.json({
        success: true,
        data: analytics,
      });

    } catch (error: any) {
      console.error("❌ Export analytics error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to export analytics",
        error: error.message,
      });
    }
  }

  // ==================== HELPER METHODS ====================

  private static async getAnalyticsData(filters: any): Promise<any> {
    // Simplified version for export
    const institutionRepo = dbConnection.getRepository(Institution);
    const memberRepo = dbConnection.getRepository(InstitutionMember);
    const courseRepo = dbConnection.getRepository(Course);

    const institutions = await institutionRepo.find();
    const members = await memberRepo.find();
    const courses = await courseRepo.find();

    return {
      summary: {
        total_institutions: institutions.length,
        total_members: members.length,
        total_courses: courses.length,
      },
      institutions: institutions.map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        members: members.filter(m => m.institution_id === i.id).length,
        courses: courses.filter(c => c.institution_id === i.id).length,
        status: i.is_active ? "Active" : "Inactive",
      })),
    };
  }

  private static convertToCSV(data: any): string {
    const rows = [
      ["Metric", "Value"],
      ["Total Institutions", data.summary.total_institutions],
      ["Total Members", data.summary.total_members],
      ["Total Courses", data.summary.total_courses],
      ["", ""],
      ["Institution ID", "Name", "Type", "Members", "Courses", "Status"],
    ];

    data.institutions.forEach((inst: any) => {
      rows.push([
        inst.id,
        inst.name,
        inst.type,
        inst.members.toString(),
        inst.courses.toString(),
        inst.status,
      ]);
    });

    return rows.map(row => row.join(",")).join("\n");
  }

  private static calculateGrowthRates(data: any[]): { daily: number; weekly: number; monthly: number; yearly: number } {
    if (data.length < 2) {
      return { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    }

    const recent = data[data.length - 1].count;
    const previous = data[data.length - 2].count;
    const dailyGrowth = previous > 0 ? (recent - previous) / previous : 0;

    const recentWeek = data.slice(-7).reduce((sum, d) => sum + d.count, 0);
    const previousWeek = data.slice(-14, -7).reduce((sum, d) => sum + d.count, 0);
    const weeklyGrowth = previousWeek > 0 ? (recentWeek - previousWeek) / previousWeek : 0;

    const recentMonth = data.slice(-30).reduce((sum, d) => sum + d.count, 0);
    const previousMonth = data.slice(-60, -30).reduce((sum, d) => sum + d.count, 0);
    const monthlyGrowth = previousMonth > 0 ? (recentMonth - previousMonth) / previousMonth : 0;

    return {
      daily: dailyGrowth,
      weekly: weeklyGrowth,
      monthly: monthlyGrowth,
      yearly: monthlyGrowth * 12, // Approximate
    };
  }

  private static getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      UNIVERSITY: "#3b82f6",
      GOVERNMENT: "#10b981",
      PRIVATE_COMPANY: "#f59e0b",
      NGO: "#8b5cf6",
    };
    return colors[type] || "#6b7280";
  }
}