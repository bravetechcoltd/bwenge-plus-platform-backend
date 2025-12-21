// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import {
  SystemAnalyticsEvent,
  SystemAnalyticsDaily,
  AnalyticsEventType,
} from "../database/models/SystemAnalytics";
import { User, BwengeRole } from "../database/models/User";
import { Between, MoreThan, LessThan, Raw } from "typeorm";

export class SystemAnalyticsController {
  
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

  // GET /api/system-settings/analytics/dashboard
  static async getDashboardStats(req: Request, res: Response) {
    try {
      if (!(await SystemAnalyticsController.verifySystemAdmin(req, res))) return;

      const { period = "30d" } = req.query;

      const startDate = getStartDateFromPeriod(period as string);
      const endDate = new Date();

      const eventRepo = dbConnection.getRepository(SystemAnalyticsEvent);
      const userRepo = dbConnection.getRepository(User);
      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      // User metrics
      const totalUsers = await userRepo.count();
      const newUsers = await userRepo.count({
        where: { date_joined: Between(startDate, endDate) },
      });
      const activeUsers = await eventRepo
        .createQueryBuilder("event")
        .select("COUNT(DISTINCT event.user_id)", "count")
        .where("event.timestamp BETWEEN :start AND :end", { start: startDate, end: endDate })
        .andWhere("event.user_id IS NOT NULL")
        .getRawOne();

      // Course metrics
      const totalCourses = await courseRepo.count();
      const newCourses = await courseRepo.count({
        where: { created_at: Between(startDate, endDate) },
      });
      const publishedCourses = await courseRepo.count({ where: { status: "PUBLISHED" } });

      // Enrollment metrics
      const totalEnrollments = await enrollmentRepo.count();
      const newEnrollments = await enrollmentRepo.count({
        where: { enrolled_at: Between(startDate, endDate) },
      });
      const completedEnrollments = await enrollmentRepo.count({
        where: {
          status: "COMPLETED",
          completion_date: Between(startDate, endDate),
        },
      });

      // Revenue metrics (from payment transactions)
      const transactionRepo = dbConnection.getRepository(PaymentTransaction);
      const revenueData = await transactionRepo
        .createQueryBuilder("transaction")
        .select([
          "SUM(transaction.amount) AS total_revenue",
          "SUM(transaction.fee_amount) AS total_fees",
          "SUM(transaction.net_amount) AS total_net",
          "COUNT(*) AS transaction_count",
        ])
        .where("transaction.status = :status", { status: "SUCCESS" })
        .andWhere("transaction.paid_at BETWEEN :start AND :end", { start: startDate, end: endDate })
        .getRawOne();

      // Event counts by type
      const eventCounts = await eventRepo
        .createQueryBuilder("event")
        .select("event.event_type", "type")
        .addSelect("COUNT(*)", "count")
        .where("event.timestamp BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy("event.event_type")
        .getRawMany();

      res.json({
        success: true,
        data: {
          period: {
            start: startDate,
            end: endDate,
            label: period,
          },
          users: {
            total: totalUsers,
            new: newUsers,
            active: parseInt(activeUsers?.count || "0"),
          },
          courses: {
            total: totalCourses,
            new: newCourses,
            published: publishedCourses,
          },
          enrollments: {
            total: totalEnrollments,
            new: newEnrollments,
            completed: completedEnrollments,
          },
          revenue: {
            total: parseFloat(revenueData?.total_revenue || "0"),
            fees: parseFloat(revenueData?.total_fees || "0"),
            net: parseFloat(revenueData?.total_net || "0"),
            transactions: parseInt(revenueData?.transaction_count || "0"),
          },
          events: eventCounts.map(e => ({
            type: e.type,
            count: parseInt(e.count),
          })),
        },
      });
    } catch (error: any) {
      console.error("❌ Get dashboard stats error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch dashboard statistics",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/analytics/timeseries
  static async getTimeSeriesData(req: Request, res: Response) {
    try {
      if (!(await SystemAnalyticsController.verifySystemAdmin(req, res))) return;

      const {
        metric = "users",
        interval = "day",
        from,
        to,
      } = req.query;

      const startDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = to ? new Date(to as string) : new Date();

      let data: any[] = [];

      if (metric === "users") {
        const userRepo = dbConnection.getRepository(User);
        const users = await userRepo
          .createQueryBuilder("user")
          .select(`DATE_TRUNC('${interval}', user.date_joined)`, "date")
          .addSelect("COUNT(*)", "count")
          .where("user.date_joined BETWEEN :start AND :end", { start: startDate, end: endDate })
          .groupBy(`DATE_TRUNC('${interval}', user.date_joined)`)
          .orderBy("date", "ASC")
          .getRawMany();
        data = users;
      } else if (metric === "enrollments") {
        const enrollmentRepo = dbConnection.getRepository(Enrollment);
        const enrollments = await enrollmentRepo
          .createQueryBuilder("enrollment")
          .select(`DATE_TRUNC('${interval}', enrollment.enrolled_at)`, "date")
          .addSelect("COUNT(*)", "count")
          .where("enrollment.enrolled_at BETWEEN :start AND :end", { start: startDate, end: endDate })
          .groupBy(`DATE_TRUNC('${interval}', enrollment.enrolled_at)`)
          .orderBy("date", "ASC")
          .getRawMany();
        data = enrollments;
      } else if (metric === "revenue") {
        const transactionRepo = dbConnection.getRepository(PaymentTransaction);
        const revenue = await transactionRepo
          .createQueryBuilder("transaction")
          .select(`DATE_TRUNC('${interval}', transaction.paid_at)`, "date")
          .addSelect("SUM(transaction.amount)", "amount")
          .addSelect("COUNT(*)", "count")
          .where("transaction.status = :status", { status: "SUCCESS" })
          .andWhere("transaction.paid_at BETWEEN :start AND :end", { start: startDate, end: endDate })
          .groupBy(`DATE_TRUNC('${interval}', transaction.paid_at)`)
          .orderBy("date", "ASC")
          .getRawMany();
        data = revenue;
      }

      res.json({
        success: true,
        data: {
          metric,
          interval,
          from: startDate,
          to: endDate,
          points: data.map(d => ({
            date: d.date,
            value: parseFloat(d.amount || d.count),
            count: parseInt(d.count || "0"),
          })),
        },
      });
    } catch (error: any) {
      console.error("❌ Get time series data error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch time series data",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/analytics/top-courses
  static async getTopCourses(req: Request, res: Response) {
    try {
      if (!(await SystemAnalyticsController.verifySystemAdmin(req, res))) return;

      const { limit = 10, sort_by = "enrollments" } = req.query;

      const courseRepo = dbConnection.getRepository(Course);

      let courses;
      if (sort_by === "enrollments") {
        courses = await courseRepo
          .createQueryBuilder("course")
          .leftJoinAndSelect("course.instructor", "instructor")
          .orderBy("course.enrollment_count", "DESC")
          .limit(Number(limit))
          .getMany();
      } else if (sort_by === "rating") {
        courses = await courseRepo
          .createQueryBuilder("course")
          .leftJoinAndSelect("course.instructor", "instructor")
          .where("course.total_reviews > 0")
          .orderBy("course.average_rating", "DESC")
          .limit(Number(limit))
          .getMany();
      } else if (sort_by === "revenue") {
        const transactionRepo = dbConnection.getRepository(PaymentTransaction);
        const courseRevenue = await transactionRepo
          .createQueryBuilder("transaction")
          .select("transaction.course_id", "course_id")
          .addSelect("SUM(transaction.amount)", "revenue")
          .addSelect("COUNT(*)", "transactions")
          .where("transaction.status = :status", { status: "SUCCESS" })
          .andWhere("transaction.course_id IS NOT NULL")
          .groupBy("transaction.course_id")
          .orderBy("revenue", "DESC")
          .limit(Number(limit))
          .getRawMany();

        const courseIds = courseRevenue.map(c => c.course_id);
        courses = await courseRepo.findByIds(courseIds, {
          relations: ["instructor"],
        });

        // Attach revenue data
        courses = courses.map(course => {
          const revenueData = courseRevenue.find(c => c.course_id === course.id);
          return {
            ...course,
            revenue: parseFloat(revenueData?.revenue || "0"),
            transactions: parseInt(revenueData?.transactions || "0"),
          };
        });
      }

      res.json({
        success: true,
        data: courses,
      });
    } catch (error: any) {
      console.error("❌ Get top courses error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch top courses",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/analytics/user-activity
  static async getUserActivity(req: Request, res: Response) {
    try {
      if (!(await SystemAnalyticsController.verifySystemAdmin(req, res))) return;

      const { days = 30 } = req.query;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - Number(days));

      const eventRepo = dbConnection.getRepository(SystemAnalyticsEvent);

      const dailyActive = await eventRepo
        .createQueryBuilder("event")
        .select("DATE(event.timestamp)", "date")
        .addSelect("COUNT(DISTINCT event.user_id)", "active_users")
        .where("event.timestamp >= :start", { start: startDate })
        .andWhere("event.user_id IS NOT NULL")
        .groupBy("DATE(event.timestamp)")
        .orderBy("date", "ASC")
        .getRawMany();

      const hourlyActivity = await eventRepo
        .createQueryBuilder("event")
        .select("EXTRACT(HOUR FROM event.timestamp)", "hour")
        .addSelect("COUNT(*)", "count")
        .where("event.timestamp >= :start", { start: startDate })
        .groupBy("EXTRACT(HOUR FROM event.timestamp)")
        .orderBy("hour", "ASC")
        .getRawMany();

      res.json({
        success: true,
        data: {
          daily_active: dailyActive.map(d => ({
            date: d.date,
            count: parseInt(d.active_users),
          })),
          hourly_distribution: hourlyActivity.map(h => ({
            hour: parseInt(h.hour),
            count: parseInt(h.count),
          })),
        },
      });
    } catch (error: any) {
      console.error("❌ Get user activity error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user activity",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/analytics/export
  static async exportAnalytics(req: Request, res: Response) {
    try {
      if (!(await SystemAnalyticsController.verifySystemAdmin(req, res))) return;

      const { from, to, format = "csv" } = req.query;

      const startDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = to ? new Date(to as string) : new Date();

      const eventRepo = dbConnection.getRepository(SystemAnalyticsEvent);

      const events = await eventRepo.find({
        where: {
          timestamp: Between(startDate, endDate),
        },
        order: { timestamp: "ASC" },
      });

      if (format === "csv") {
        const headers = [
          "ID",
          "Event Type",
          "User ID",
          "Timestamp",
          "Course ID",
          "Institution ID",
          "Value",
          "Properties",
          "Country",
          "Device",
        ];

        const rows = events.map(e => [
          e.id,
          e.event_type,
          e.user_id || "",
          e.timestamp.toISOString(),
          e.course_id || "",
          e.institution_id || "",
          e.value || "",
          JSON.stringify(e.properties || {}),
          e.context?.country || "",
          e.context?.device || "",
        ]);

        const csvContent = [
          headers.join(","),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(",")),
        ].join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=analytics_export_${new Date().toISOString().split("T")[0]}.csv`
        );
        return res.send(csvContent);
      }

      res.json({
        success: true,
        data: {
          from: startDate,
          to: endDate,
          total_events: events.length,
          events,
        },
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

  // GET /api/system-settings/analytics/events
  static async getEventTypes(req: Request, res: Response) {
    try {
      if (!(await SystemAnalyticsController.verifySystemAdmin(req, res))) return;

      res.json({
        success: true,
        data: {
          event_types: Object.values(AnalyticsEventType).map(type => ({
            value: type,
            label: type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
          })),
        },
      });
    } catch (error: any) {
      console.error("❌ Get event types error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch event types",
        error: error.message,
      });
    }
  }
}

function getStartDateFromPeriod(period: string): Date {
  const now = new Date();
  switch (period) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "1y":
      return new Date(now.setFullYear(now.getFullYear() - 1));
    default:
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}