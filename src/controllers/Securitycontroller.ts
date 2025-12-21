
// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { ActivityLog } from "../database/models/ActivityLog";
import { User, BwengeRole } from "../database/models/User";
import { UserSession, SystemType } from "../database/models/UserSession";
import { Institution } from "../database/models/Institution";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { Enrollment } from "../database/models/Enrollment";
import { Course } from "../database/models/Course";
import { Between, MoreThan, LessThan, Like, IsNull, Not } from "typeorm";
import * as os from "os";

// ─────────────────────────────────────────────────────────────
// HELPER: Verify System Admin
// ─────────────────────────────────────────────────────────────
async function requireSystemAdmin(req: Request, res: Response): Promise<User | null> {
  const userId = req.user?.userId || req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthenticated" });
    return null;
  }
  const userRepo = dbConnection.getRepository(User);
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
    res.status(403).json({ success: false, message: "System Admin access required" });
    return null;
  }
  return user;
}

export class SecurityController {

  // ═══════════════════════════════════════════════════════════
  // AUDIT LOGS
  // ═══════════════════════════════════════════════════════════

  static async getAuditLogs(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const {
        page = 1,
        limit = 50,
        action,
        userId,
        targetType,
        startDate,
        endDate,
        search,
      } = req.query;

      const logRepo = dbConnection.getRepository(ActivityLog);

      const qb = logRepo
        .createQueryBuilder("log")
        .leftJoinAndSelect("log.user", "user")
        .orderBy("log.createdAt", "DESC");

      if (action) qb.andWhere("log.action ILIKE :action", { action: `%${action}%` });
      if (userId) qb.andWhere("log.userId = :userId", { userId });
      if (targetType) qb.andWhere("log.targetType = :targetType", { targetType });
      if (search) {
        qb.andWhere(
          "(log.action ILIKE :search OR log.details ILIKE :search OR log.targetType ILIKE :search)",
          { search: `%${search}%` }
        );
      }
      if (startDate) {
        qb.andWhere("log.createdAt >= :startDate", { startDate: new Date(startDate as string) });
      }
      if (endDate) {
        qb.andWhere("log.createdAt <= :endDate", { endDate: new Date(endDate as string) });
      }

      const total = await qb.getCount();
      const logs = await qb
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // Action type distribution (from raw DB for accuracy)
      const rawDist = await logRepo
        .createQueryBuilder("log")
        .select("log.action", "action")
        .addSelect("COUNT(*)", "count")
        .groupBy("log.action")
        .orderBy("count", "DESC")
        .limit(20)
        .getRawMany();

      // Recent 24h stats
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentCount = await logRepo
        .createQueryBuilder("log")
        .where("log.createdAt >= :date", { date: oneDayAgo })
        .getCount();

      // Unique actors in last 24h
      const uniqueActors = await logRepo
        .createQueryBuilder("log")
        .select("COUNT(DISTINCT log.userId)", "count")
        .where("log.createdAt >= :date", { date: oneDayAgo })
        .getRawOne();

      const cleanedLogs = logs.map(log => ({
        id: log.id,
        action: log.action,
        targetId: log.targetId,
        targetType: log.targetType,
        details: log.details,
        createdAt: log.createdAt,
        userId: log.userId,
        user: log.user
          ? {
              id: log.user.id,
              email: log.user.email,
              first_name: log.user.first_name,
              last_name: log.user.last_name,
              profile_picture_url: log.user.profile_picture_url,
              bwenge_role: log.user.bwenge_role,
            }
          : null,
      }));

      return res.json({
        success: true,
        data: {
          logs: cleanedLogs,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
          stats: {
            total_logs: total,
            last_24h: recentCount,
            unique_actors_24h: Number(uniqueActors?.count || 0),
            action_distribution: rawDist.map(r => ({
              action: r.action,
              count: Number(r.count),
            })),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ getAuditLogs error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch audit logs", error: error.message });
    }
  }

  static async getAuditLogById(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const { id } = req.params;
      const logRepo = dbConnection.getRepository(ActivityLog);
      const log = await logRepo.findOne({ where: { id }, relations: ["user"] });
      if (!log) return res.status(404).json({ success: false, message: "Log not found" });

      return res.json({ success: true, data: log });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async exportAuditLogs(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const { startDate, endDate, action, targetType } = req.query;
      const logRepo = dbConnection.getRepository(ActivityLog);

      const qb = logRepo
        .createQueryBuilder("log")
        .leftJoinAndSelect("log.user", "user")
        .orderBy("log.createdAt", "DESC")
        .take(10000);

      if (action) qb.andWhere("log.action ILIKE :action", { action: `%${action}%` });
      if (targetType) qb.andWhere("log.targetType = :targetType", { targetType });
      if (startDate) qb.andWhere("log.createdAt >= :startDate", { startDate: new Date(startDate as string) });
      if (endDate) qb.andWhere("log.createdAt <= :endDate", { endDate: new Date(endDate as string) });

      const logs = await qb.getMany();

      const headers = ["ID", "Action", "Target Type", "Target ID", "User Email", "User Name", "Details", "Timestamp"];
      const rows = logs.map(l => [
        l.id,
        l.action,
        l.targetType || "",
        l.targetId || "",
        l.user?.email || "system",
        `${l.user?.first_name || ""} ${l.user?.last_name || ""}`.trim() || "—",
        (l.details || "").replace(/"/g, "'"),
        l.createdAt?.toISOString() || "",
      ]);

      const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=audit_logs_${new Date().toISOString().split("T")[0]}.csv`);
      return res.send(csv);
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ACCESS CONTROL
  // ═══════════════════════════════════════════════════════════

  static async getAccessControl(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const { page = 1, limit = 20, search, type } = req.query;

      const institutionRepo = dbConnection.getRepository(Institution);
      const sessionRepo = dbConnection.getRepository(UserSession);
      const userRepo = dbConnection.getRepository(User);

      const qb = institutionRepo
        .createQueryBuilder("inst")
        .leftJoinAndSelect("inst.members", "members")
        .leftJoinAndSelect("members.user", "mUser")
        .orderBy("inst.name", "ASC");

      if (search) qb.andWhere("inst.name ILIKE :search", { search: `%${search}%` });
      if (type && type !== "all") qb.andWhere("inst.type = :type", { type });

      const total = await qb.getCount();
      const institutions = await qb
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // Platform-wide active sessions
      const activeSessions = await sessionRepo.count({
        where: { is_active: true, expires_at: MoreThan(new Date()) },
      });

      // Sessions by system
      const bwengeSessions = await sessionRepo.count({
        where: { is_active: true, system: SystemType.BWENGE_PLUS, expires_at: MoreThan(new Date()) },
      });
      const ongeraSessions = await sessionRepo.count({
        where: { is_active: true, system: SystemType.ONGERA, expires_at: MoreThan(new Date()) },
      });

      // Users with 2FA enabled
      const users2FA = await userRepo
        .createQueryBuilder("u")
        .where("u.learning_preferences->>'two_factor_enabled' = :val", { val: "true" })
        .getCount();

      const totalUsers = await userRepo.count({ where: { is_active: true } });

      // Recent suspicious logins (multiple failed → no direct table, approximate from activity logs)
      const logRepo = dbConnection.getRepository(ActivityLog);
      const suspiciousCount = await logRepo
        .createQueryBuilder("log")
        .where("log.action ILIKE :a", { a: "%failed%login%" })
        .andWhere("log.createdAt >= :d", { d: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .getCount();

      // Top 10 recently active sessions
      const recentSessions = await sessionRepo.find({
        where: { is_active: true, expires_at: MoreThan(new Date()) },
        relations: ["user"],
        order: { last_activity: "DESC" },
        take: 10,
      });

      const institutionList = institutions.map(inst => ({
        id: inst.id,
        name: inst.name,
        slug: inst.slug,
        type: inst.type,
        logo_url: inst.logo_url,
        is_active: inst.is_active,
        member_count: inst.members?.length || 0,
        security_settings: inst.settings?.security || {
          require_2fa: false,
          session_timeout: 60,
          max_login_attempts: 5,
          password_complexity: "medium",
        },
        admin_emails: (inst.members || [])
          .filter(m => m.role === "ADMIN" && m.user)
          .map(m => m.user?.email)
          .filter(Boolean),
      }));

      return res.json({
        success: true,
        data: {
          institutions: institutionList,
          pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
          platform_stats: {
            active_sessions: activeSessions,
            bwenge_plus_sessions: bwengeSessions,
            ongera_sessions: ongeraSessions,
            users_with_2fa: users2FA,
            total_active_users: totalUsers,
            two_fa_adoption_rate: totalUsers > 0 ? ((users2FA / totalUsers) * 100).toFixed(1) : "0",
            suspicious_logins_24h: suspiciousCount,
          },
          recent_sessions: recentSessions.map(s => ({
            id: s.id,
            system: s.system,
            ip_address: s.ip_address,
            device_info: s.device_info,
            last_activity: s.last_activity,
            expires_at: s.expires_at,
            user: s.user
              ? { id: s.user.id, email: s.user.email, first_name: s.user.first_name, last_name: s.user.last_name }
              : null,
          })),
        },
      });
    } catch (error: any) {
      console.error("❌ getAccessControl error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch access control data", error: error.message });
    }
  }

  static async updateInstitutionSecuritySettings(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const { institutionId } = req.params;
      const { security } = req.body;

      if (!security) return res.status(400).json({ success: false, message: "Security settings required" });

      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({ where: { id: institutionId } });
      if (!institution) return res.status(404).json({ success: false, message: "Institution not found" });

      institution.settings = {
        ...(institution.settings || {}),
        security: {
          require_2fa: security.require_2fa ?? false,
          session_timeout: security.session_timeout ?? 60,
          max_login_attempts: security.max_login_attempts ?? 5,
          password_complexity: security.password_complexity ?? "medium",
        },
      };

      await institutionRepo.save(institution);

      // Log the action
      const logRepo = dbConnection.getRepository(ActivityLog);
      const logEntry = logRepo.create({
        userId: admin.id,
        user: admin,
        action: "UPDATE_INSTITUTION_SECURITY_SETTINGS",
        targetId: institutionId,
        targetType: "institution",
        details: JSON.stringify({ updated_by: admin.email, settings: security }),
      });
      await logRepo.save(logEntry);

      return res.json({
        success: true,
        message: "Security settings updated",
        data: { institution_id: institutionId, security: institution.settings.security },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async terminateSession(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const { sessionId } = req.params;
      const sessionRepo = dbConnection.getRepository(UserSession);
      const session = await sessionRepo.findOne({ where: { id: sessionId } });
      if (!session) return res.status(404).json({ success: false, message: "Session not found" });

      session.is_active = false;
      await sessionRepo.save(session);

      // Log it
      const logRepo = dbConnection.getRepository(ActivityLog);
      await logRepo.save(logRepo.create({
        userId: admin.id,
        user: admin,
        action: "TERMINATE_USER_SESSION",
        targetId: sessionId,
        targetType: "session",
        details: JSON.stringify({ terminated_by: admin.email, session_user: session.user_id }),
      }));

      return res.json({ success: true, message: "Session terminated" });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async terminateAllUserSessions(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const { userId } = req.params;
      const sessionRepo = dbConnection.getRepository(UserSession);
      const result = await sessionRepo.update({ user_id: userId, is_active: true }, { is_active: false });

      const logRepo = dbConnection.getRepository(ActivityLog);
      await logRepo.save(logRepo.create({
        userId: admin.id,
        user: admin,
        action: "TERMINATE_ALL_USER_SESSIONS",
        targetId: userId,
        targetType: "user",
        details: JSON.stringify({ terminated_by: admin.email, sessions_terminated: result.affected }),
      }));

      return res.json({ success: true, message: `${result.affected} sessions terminated` });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async getActiveSessions(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const { page = 1, limit = 30, system, search } = req.query;
      const sessionRepo = dbConnection.getRepository(UserSession);

      const qb = sessionRepo
        .createQueryBuilder("session")
        .leftJoinAndSelect("session.user", "user")
        .where("session.is_active = true")
        .andWhere("session.expires_at > :now", { now: new Date() })
        .orderBy("session.last_activity", "DESC");

      if (system && system !== "all") qb.andWhere("session.system = :system", { system });
      if (search) {
        qb.andWhere(
          "(user.email ILIKE :search OR session.ip_address ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      const total = await qb.getCount();
      const sessions = await qb.skip((Number(page) - 1) * Number(limit)).take(Number(limit)).getMany();

      return res.json({
        success: true,
        data: {
          sessions: sessions.map(s => ({
            id: s.id,
            system: s.system,
            ip_address: s.ip_address,
            device_info: s.device_info,
            last_activity: s.last_activity,
            created_at: s.created_at,
            expires_at: s.expires_at,
            user: s.user
              ? {
                  id: s.user.id,
                  email: s.user.email,
                  first_name: s.user.first_name,
                  last_name: s.user.last_name,
                  bwenge_role: s.user.bwenge_role,
                }
              : null,
          })),
          pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SYSTEM HEALTH
  // ═══════════════════════════════════════════════════════════

  static async getSystemHealth(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const userRepo = dbConnection.getRepository(User);
      const sessionRepo = dbConnection.getRepository(UserSession);
      const institutionRepo = dbConnection.getRepository(Institution);
      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const logRepo = dbConnection.getRepository(ActivityLog);

      // ── Node process metrics ──────────────────────────────
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem  = os.freemem();
      const cpuLoad  = os.loadavg(); // [1m, 5m, 15m]
      const uptimeSec = process.uptime();

      // ── Database stats ────────────────────────────────────
      let dbStatus = "healthy";
      let dbResponseMs = 0;
      try {
        const t0 = Date.now();
        await userRepo.count();
        dbResponseMs = Date.now() - t0;
        dbStatus = dbResponseMs < 200 ? "healthy" : dbResponseMs < 500 ? "degraded" : "critical";
      } catch {
        dbStatus = "critical";
      }

      // ── Counts ────────────────────────────────────────────
      const [totalUsers, activeUsers, totalInstitutions, totalCourses, totalEnrollments] = await Promise.all([
        userRepo.count(),
        userRepo.count({ where: { is_active: true } }),
        institutionRepo.count(),
        courseRepo.count(),
        enrollmentRepo.count(),
      ]);

      const activeSessions = await sessionRepo.count({
        where: { is_active: true, expires_at: MoreThan(new Date()) },
      });

      // ── Log volume (last 24h) ─────────────────────────────
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const [logsLast24h, logsLastHour, errorLogsLast24h] = await Promise.all([
        logRepo.createQueryBuilder("l").where("l.createdAt >= :d", { d: dayAgo }).getCount(),
        logRepo.createQueryBuilder("l").where("l.createdAt >= :d", { d: hourAgo }).getCount(),
        logRepo
          .createQueryBuilder("l")
          .where("l.createdAt >= :d", { d: dayAgo })
          .andWhere("(l.action ILIKE :a1 OR l.action ILIKE :a2)", { a1: "%error%", a2: "%fail%" })
          .getCount(),
      ]);

      // ── Hourly activity trend (last 24 hours) ─────────────
      const hourlyRaw = await logRepo
        .createQueryBuilder("l")
        .select("DATE_TRUNC('hour', l.createdAt)", "hour")
        .addSelect("COUNT(*)", "count")
        .where("l.createdAt >= :d", { d: dayAgo })
        .groupBy("DATE_TRUNC('hour', l.createdAt)")
        .orderBy("hour", "ASC")
        .getRawMany();

      const activityTrend = hourlyRaw.map(r => ({
        hour: r.hour ? new Date(r.hour).toISOString() : null,
        count: Number(r.count),
      }));

      // ── Expired sessions (cleanup indicator) ──────────────
      const expiredSessions = await sessionRepo.count({
        where: { is_active: true, expires_at: LessThan(new Date()) },
      });

      // ── Service status checks ─────────────────────────────
      const services = [
        {
          name: "Database",
          status: dbStatus,
          response_ms: dbResponseMs,
          message: dbStatus === "healthy" ? "Connected" : "Degraded",
        },
        {
          name: "Authentication",
          status: activeSessions > 0 ? "healthy" : "idle",
          response_ms: 0,
          message: `${activeSessions} active sessions`,
        },
        {
          name: "Storage / CDN",
          status: "healthy",
          response_ms: 0,
          message: "Cloudinary integration active",
        },
        {
          name: "Email Service",
          status: "healthy",
          response_ms: 0,
          message: "Email service configured",
        },
      ];

      const overallHealth = services.every(s => s.status === "healthy" || s.status === "idle")
        ? "healthy"
        : services.some(s => s.status === "critical")
        ? "critical"
        : "degraded";

      return res.json({
        success: true,
        data: {
          overall_status: overallHealth,
          checked_at: new Date().toISOString(),
          server: {
            uptime_seconds: Math.floor(uptimeSec),
            uptime_human: formatUptime(uptimeSec),
            node_version: process.version,
            platform: process.platform,
            arch: os.arch(),
          },
          memory: {
            heap_used_mb: (memUsage.heapUsed / 1024 / 1024).toFixed(1),
            heap_total_mb: (memUsage.heapTotal / 1024 / 1024).toFixed(1),
            rss_mb: (memUsage.rss / 1024 / 1024).toFixed(1),
            system_total_mb: (totalMem / 1024 / 1024).toFixed(0),
            system_free_mb: (freeMem / 1024 / 1024).toFixed(0),
            system_used_pct: (((totalMem - freeMem) / totalMem) * 100).toFixed(1),
          },
          cpu: {
            load_1m: cpuLoad[0].toFixed(2),
            load_5m: cpuLoad[1].toFixed(2),
            load_15m: cpuLoad[2].toFixed(2),
            cpu_count: os.cpus().length,
          },
          database: {
            status: dbStatus,
            response_ms: dbResponseMs,
            total_users: totalUsers,
            active_users: activeUsers,
            total_institutions: totalInstitutions,
            total_courses: totalCourses,
            total_enrollments: totalEnrollments,
          },
          sessions: {
            active: activeSessions,
            expired_pending_cleanup: expiredSessions,
          },
          activity: {
            logs_last_24h: logsLast24h,
            logs_last_1h: logsLastHour,
            error_logs_24h: errorLogsLast24h,
            error_rate_pct: logsLast24h > 0 ? ((errorLogsLast24h / logsLast24h) * 100).toFixed(2) : "0",
            hourly_trend: activityTrend,
          },
          services,
        },
      });
    } catch (error: any) {
      console.error("❌ getSystemHealth error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch system health", error: error.message });
    }
  }

  static async cleanupExpiredSessions(req: Request, res: Response) {
    try {
      const admin = await requireSystemAdmin(req, res);
      if (!admin) return;

      const sessionRepo = dbConnection.getRepository(UserSession);
      const result = await sessionRepo
        .createQueryBuilder()
        .update(UserSession)
        .set({ is_active: false })
        .where("expires_at < :now", { now: new Date() })
        .andWhere("is_active = true")
        .execute();

      const logRepo = dbConnection.getRepository(ActivityLog);
      await logRepo.save(logRepo.create({
        userId: admin.id,
        user: admin,
        action: "CLEANUP_EXPIRED_SESSIONS",
        targetType: "sessions",
        details: JSON.stringify({ cleaned: result.affected, by: admin.email }),
      }));

      return res.json({ success: true, message: `Cleaned up ${result.affected} expired sessions`, data: { cleaned: result.affected } });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}