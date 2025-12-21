import { Request, Response } from "express";
import dbConnection from "../database/db";
import { User, BwengeRole, AccountType } from "../database/models/User";
import { UserSession, SystemType } from "../database/models/UserSession";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { Certificate } from "../database/models/Certificate";
import { Between, MoreThanOrEqual, LessThanOrEqual, In } from "typeorm";
import { format, subDays, subMonths, subYears, startOfDay, endOfDay } from "date-fns";

export class SystemAdminUserAnalyticsController {

  // ── GET /system-admin/users/analytics ─────────────────────────────────────
  static async getUserAnalytics(req: Request, res: Response) {
    try {
      const { time_range = "30d", system = "all" } = req.query;

      const userRepo    = dbConnection.getRepository(User);
      const sessionRepo = dbConnection.getRepository(UserSession);
      const enrollRepo  = dbConnection.getRepository(Enrollment);
      const certRepo    = dbConnection.getRepository(Certificate);

      const now      = new Date();
      const days     = ({ "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as any)[time_range as string] ?? 30;
      const rangeStart = subDays(now, days);
      const oneMonthAgo = subMonths(now, 1);
      const lastMonthStart = subMonths(now, 2);
      const oneDayAgo   = subDays(now, 1);
      const oneWeekAgo  = subDays(now, 7);

      // ── base user query ───────────────────────────────────────────────────
      const userQuery = userRepo.createQueryBuilder("u");

      if (system !== "all") {
        const systemVal = system === "bwengeplus" ? SystemType.BWENGE_PLUS : SystemType.ONGERA;
        userQuery.andWhere("u.\"IsForWhichSystem\" = :sys", { sys: systemVal });
      }

      const allUsers = await userQuery.getMany();

      // ── summary ───────────────────────────────────────────────────────────
      const totalUsers    = allUsers.length;
      const activeUsers   = allUsers.filter(u => u.is_active).length;
      const verifiedUsers = allUsers.filter(u => u.is_verified).length;
      const inactiveUsers = totalUsers - activeUsers;

      const newUsersThisMonth = allUsers.filter(u =>
        new Date(u.date_joined) >= oneMonthAgo
      ).length;

      const newUsersLastMonth = allUsers.filter(u =>
        new Date(u.date_joined) >= lastMonthStart &&
        new Date(u.date_joined) < oneMonthAgo
      ).length;

      const growthRate = newUsersLastMonth > 0
        ? ((newUsersThisMonth - newUsersLastMonth) / newUsersLastMonth) * 100
        : newUsersThisMonth > 0 ? 100 : 0;

      const verificationRate = totalUsers > 0 ? (verifiedUsers / totalUsers) * 100 : 0;
      const activationRate   = totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0;

      const bwengePlusUsers = allUsers.filter(u =>
        u.IsForWhichSystem?.toLowerCase() === SystemType.BWENGE_PLUS
      );
      const ongeraUsers = allUsers.filter(u =>
        u.IsForWhichSystem?.toLowerCase() === SystemType.ONGERA
      );

      // ── by_role ───────────────────────────────────────────────────────────
      const by_role: Record<string, number> = {};
      Object.values(BwengeRole).forEach(role => {
        by_role[role] = allUsers.filter(u => u.bwenge_role === role).length;
      });

      // ── by_account_type ───────────────────────────────────────────────────
      const by_account_type: Record<string, number> = {};
      Object.values(AccountType).forEach(type => {
        by_account_type[type] = allUsers.filter(u => u.account_type === type).length;
      });

      // ── by_system ─────────────────────────────────────────────────────────
      const by_system = {
        bwengeplus: {
          total:    bwengePlusUsers.length,
          active:   bwengePlusUsers.filter(u => u.is_active).length,
          verified: bwengePlusUsers.filter(u => u.is_verified).length,
        },
        ongera: {
          total:    ongeraUsers.length,
          active:   ongeraUsers.filter(u => u.is_active).length,
          verified: ongeraUsers.filter(u => u.is_verified).length,
        },
      };

      // ── trends ────────────────────────────────────────────────────────────
      const trendDays = Math.min(days, 90);
      const periods = Array.from({ length: trendDays }, (_, i) => {
        const date = subDays(now, trendDays - 1 - i);
        return { date, period: format(date, "MMM d") };
      });

      const users_over_time = periods.map(p => {
        const cutoff = endOfDay(p.date);
        const total  = allUsers.filter(u => new Date(u.date_joined) <= cutoff).length;
        const active = allUsers.filter(u => u.is_active && new Date(u.date_joined) <= cutoff).length;
        const newU   = allUsers.filter(u => {
          const d = new Date(u.date_joined);
          return d >= startOfDay(p.date) && d <= cutoff;
        }).length;
        return { period: p.period, count: total, active, new: newU };
      });

      const new_registrations = periods.map(p => ({
        period: p.period,
        new: allUsers.filter(u => {
          const d = new Date(u.date_joined);
          return d >= startOfDay(p.date) && d <= endOfDay(p.date);
        }).length,
      }));

      // ── engagement ────────────────────────────────────────────────────────
      const dailyActive   = allUsers.filter(u => u.last_login && new Date(u.last_login) >= oneDayAgo).length;
      const weeklyActive  = allUsers.filter(u => u.last_login && new Date(u.last_login) >= oneWeekAgo).length;
      const monthlyActive = allUsers.filter(u => u.last_login && new Date(u.last_login) >= oneMonthAgo).length;

      const dau_mau_ratio = monthlyActive > 0 ? (dailyActive / monthlyActive) * 100 : 0;

      // Avg session duration (from sessions table)
      let avgSessionMin = 0;
      let avgSessionsPerUser = 0;
      try {
        const sessions = await sessionRepo.find({
          where: { created_at: MoreThanOrEqual(oneMonthAgo) as any, is_active: false },
          select: ["user_id", "created_at", "last_activity"],
        });

        if (sessions.length > 0) {
          const totalMinutes = sessions.reduce((sum, s) => {
            const diff = (new Date(s.last_activity).getTime() - new Date(s.created_at).getTime()) / 60000;
            return sum + Math.max(0, Math.min(diff, 120)); // cap at 2h
          }, 0);
          avgSessionMin = totalMinutes / sessions.length;

          const userSessions = new Map<string, number>();
          sessions.forEach(s => userSessions.set(s.user_id, (userSessions.get(s.user_id) || 0) + 1));
          avgSessionsPerUser = userSessions.size > 0
            ? Array.from(userSessions.values()).reduce((a, b) => a + b, 0) / userSessions.size
            : 0;
        }
      } catch {}

      // Retention (7d and 30d)
      const retainedAt7d  = allUsers.filter(u => u.last_login && new Date(u.last_login) >= oneWeekAgo && new Date(u.date_joined) < oneWeekAgo).length;
      const eligibleAt7d  = allUsers.filter(u => new Date(u.date_joined) < oneWeekAgo).length;
      const retention7d   = eligibleAt7d > 0 ? (retainedAt7d / eligibleAt7d) * 100 : 0;

      const retainedAt30d = allUsers.filter(u => u.last_login && new Date(u.last_login) >= oneMonthAgo && new Date(u.date_joined) < oneMonthAgo).length;
      const eligibleAt30d = allUsers.filter(u => new Date(u.date_joined) < oneMonthAgo).length;
      const retention30d  = eligibleAt30d > 0 ? (retainedAt30d / eligibleAt30d) * 100 : 0;

      // ── geography ─────────────────────────────────────────────────────────
      const countryMap = new Map<string, number>();
      allUsers.forEach(u => {
        if (u.country) countryMap.set(u.country, (countryMap.get(u.country) || 0) + 1);
      });
      const by_country = Array.from(countryMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([country, count]) => ({
          country,
          count,
          pct: totalUsers > 0 ? (count / totalUsers) * 100 : 0,
        }));

      // ── top learners ──────────────────────────────────────────────────────
      let top_learners: any[] = [];
      try {
        const learnersBase = allUsers
          .filter(u => u.bwenge_role === BwengeRole.LEARNER)
          .sort((a, b) => (b.completed_courses_count || 0) - (a.completed_courses_count || 0))
          .slice(0, 5);

        top_learners = learnersBase.map(u => ({
          id:                u.id,
          name:              `${u.first_name || ""} ${(u.last_name || "")?.[0] || ""}.`.trim(),
          courses_completed: u.completed_courses_count || 0,
          learning_hours:    u.total_learning_hours || 0,
          certificates:      u.certificates_earned || 0,
        }));
      } catch {}

      // ── assemble response ─────────────────────────────────────────────────
      return res.json({
        success: true,
        data: {
          summary: {
            total_users:             totalUsers,
            active_users:            activeUsers,
            inactive_users:          inactiveUsers,
            verified_users:          verifiedUsers,
            new_users_this_month:    newUsersThisMonth,
            new_users_last_month:    newUsersLastMonth,
            growth_rate:             growthRate,
            verification_rate:       verificationRate,
            activation_rate:         activationRate,
            total_bwengeplus:        bwengePlusUsers.length,
            total_ongera:            ongeraUsers.length,
          },
          by_role,
          by_account_type,
          by_system,
          trends: {
            users_over_time,
            new_registrations,
          },
          engagement: {
            daily_active:               dailyActive,
            weekly_active:              weeklyActive,
            monthly_active:             monthlyActive,
            avg_sessions_per_user:      parseFloat(avgSessionsPerUser.toFixed(1)),
            avg_session_duration_min:   parseFloat(avgSessionMin.toFixed(1)),
            retention_rate_7d:          parseFloat(retention7d.toFixed(1)),
            retention_rate_30d:         parseFloat(retention30d.toFixed(1)),
            dau_mau_ratio:              parseFloat(dau_mau_ratio.toFixed(1)),
          },
          geography: { by_country },
          top_learners,
        },
      });
    } catch (error: any) {
      console.error("❌ User analytics error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user analytics",
        error: error.message,
      });
    }
  }

  // ── GET /system-admin/users/analytics/export ──────────────────────────────
  static async exportUserAnalytics(req: Request, res: Response) {
    try {
      const { time_range = "30d", system = "all" } = req.query;
      const userRepo = dbConnection.getRepository(User);

      const userQuery = userRepo.createQueryBuilder("u");
      if (system !== "all") {
        const sysVal = system === "bwengeplus" ? SystemType.BWENGE_PLUS : SystemType.ONGERA;
        userQuery.andWhere(`u."IsForWhichSystem" = :sys`, { sys: sysVal });
      }

      const users = await userQuery.getMany();

      const rows = [
        ["ID", "First Name", "Last Name", "Email", "Role", "Account Type", "System", "Active", "Verified", "Date Joined", "Last Login"],
        ...users.map(u => [
          u.id,
          u.first_name || "",
          u.last_name  || "",
          u.email,
          u.bwenge_role || "",
          u.account_type || "",
          u.IsForWhichSystem || "",
          u.is_active ? "Yes" : "No",
          u.is_verified ? "Yes" : "No",
          u.date_joined ? format(new Date(u.date_joined), "yyyy-MM-dd") : "",
          u.last_login  ? format(new Date(u.last_login),  "yyyy-MM-dd") : "",
        ])
      ];

      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=user_analytics_${format(new Date(), "yyyy-MM-dd")}.csv`);
      return res.send(csv);
    } catch (error: any) {
      return res.status(500).json({ success: false, message: "Export failed", error: error.message });
    }
  }
}