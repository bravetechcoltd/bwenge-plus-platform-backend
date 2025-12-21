import { Request, Response } from "express";
import dbConnection from "../database/db";
import { AuditLog, AuditLogAction, AuditLogSeverity } from "../database/models/AuditLog";
import { User } from "../database/models/User";
import { Institution } from "../database/models/Institution";
import { Between, Like, In } from "typeorm";
import { format, subDays, subMonths, startOfDay, endOfDay } from "date-fns";
import { AuditLogService } from "../services/auditLogService";
export class AuditLogController {
  static async getAuditLogs(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const {
        page = 1,
        limit = 50,
        startDate,
        endDate,
        action,
        severity,
        userId: filterUserId,
        institutionId,
        search,
        export: exportFormat,
      } = req.query;

      const auditRepo = dbConnection.getRepository(AuditLog);
      const queryBuilder = auditRepo.createQueryBuilder("log")
        .leftJoinAndSelect("log.user", "user")
        .leftJoinAndSelect("log.institution", "institution");

      // Apply filters
      if (startDate) {
        queryBuilder.andWhere("log.created_at >= :startDate", { 
          startDate: new Date(startDate as string) 
        });
      }

      if (endDate) {
        queryBuilder.andWhere("log.created_at <= :endDate", { 
          endDate: new Date(endDate as string) 
        });
      }

      if (action && action !== "all") {
        queryBuilder.andWhere("log.action = :action", { action });
      }

      if (severity && severity !== "all") {
        queryBuilder.andWhere("log.severity = :severity", { severity });
      }

      if (filterUserId && filterUserId !== "all") {
        queryBuilder.andWhere("log.user_id = :filterUserId", { filterUserId });
      }

      if (institutionId && institutionId !== "all") {
        queryBuilder.andWhere("log.institution_id = :institutionId", { institutionId });
      }

      if (search) {
        queryBuilder.andWhere(
          "(log.description ILIKE :search OR user.email ILIKE :search OR institution.name ILIKE :search OR log.metadata::text ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      // Get total count
      const total = await queryBuilder.getCount();

      // Get paginated results
      const logs = await queryBuilder
        .orderBy("log.created_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // Get available filters data
      const [uniqueActions, uniqueSeverities, recentUsers, recentInstitutions] = await Promise.all([
        auditRepo
          .createQueryBuilder("log")
          .select("DISTINCT log.action", "action")
          .getRawMany(),
        auditRepo
          .createQueryBuilder("log")
          .select("DISTINCT log.severity", "severity")
          .getRawMany(),
        auditRepo
          .createQueryBuilder("log")
          .leftJoin("log.user", "user")
          .select(["log.user_id as id", "user.email as email", "user.first_name as firstName", "user.last_name as lastName"])
          .where("log.user_id IS NOT NULL")
          .groupBy("log.user_id, user.email, user.first_name, user.last_name")
          .orderBy("MAX(log.created_at)", "DESC")
          .limit(20)
          .getRawMany(),
        auditRepo
          .createQueryBuilder("log")
          .leftJoin("log.institution", "institution")
          .select(["log.institution_id as id", "institution.name as name"])
          .where("log.institution_id IS NOT NULL")
          .groupBy("log.institution_id, institution.name")
          .orderBy("MAX(log.created_at)", "DESC")
          .limit(20)
          .getRawMany(),
      ]);

      // Get summary statistics
      const last24h = subDays(new Date(), 1);
      const last7d = subDays(new Date(), 7);
      const last30d = subDays(new Date(), 30);

      const stats = {
        total_logs: total,
        last_24h: await auditRepo.count({ where: { created_at: Between(last24h, new Date()) } }),
        last_7d: await auditRepo.count({ where: { created_at: Between(last7d, new Date()) } }),
        last_30d: await auditRepo.count({ where: { created_at: Between(last30d, new Date()) } }),
        by_severity: {
          [AuditLogSeverity.INFO]: await auditRepo.count({ where: { severity: AuditLogSeverity.INFO } }),
          [AuditLogSeverity.WARNING]: await auditRepo.count({ where: { severity: AuditLogSeverity.WARNING } }),
          [AuditLogSeverity.ERROR]: await auditRepo.count({ where: { severity: AuditLogSeverity.ERROR } }),
          [AuditLogSeverity.CRITICAL]: await auditRepo.count({ where: { severity: AuditLogSeverity.CRITICAL } }),
        },
      };

      // Handle export
      if (exportFormat === 'csv') {
        const csvData = logs.map(log => ({
          Timestamp: format(log.created_at, 'yyyy-MM-dd HH:mm:ss'),
          Action: log.action,
          Severity: log.severity,
          User: log.user ? `${log.user.first_name || ''} ${log.user.last_name || ''} (${log.user.email})`.trim() : 'System',
          Institution: log.institution?.name || 'N/A',
          Description: log.description || '',
          IP: log.ip_address || 'N/A',
          'User Agent': log.user_agent || 'N/A',
        }));

        const headers = Object.keys(csvData[0] || {}).join(',');
        const rows = csvData.map(row => Object.values(row).map(v => `"${v}"`).join(','));
        const csv = [headers, ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        return res.send(csv);
      }

      res.json({
        success: true,
        data: {
          logs,
          filters: {
            actions: uniqueActions.map(a => a.action).filter(Boolean),
            severities: uniqueSeverities.map(s => s.severity).filter(Boolean),
            users: recentUsers,
            institutions: recentInstitutions,
          },
          statistics: stats,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get audit logs error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch audit logs",
        error: error.message,
      });
    }
  }

  static async getAuditLogSummary(req: Request, res: Response) {
    try {
      const { days = 30, institutionId } = req.query;

      const auditRepo = dbConnection.getRepository(AuditLog);
      const startDate = subDays(new Date(), Number(days));

      const queryBuilder = auditRepo.createQueryBuilder("log")
        .where("log.created_at >= :startDate", { startDate });

      if (institutionId) {
        queryBuilder.andWhere("log.institution_id = :institutionId", { institutionId });
      }

      // Get daily counts
      const dailyCounts = await queryBuilder
        .select("DATE(log.created_at)", "date")
        .addSelect("COUNT(*)", "count")
        .addSelect("COUNT(CASE WHEN log.severity = 'CRITICAL' THEN 1 END)", "critical")
        .addSelect("COUNT(CASE WHEN log.severity = 'ERROR' THEN 1 END)", "error")
        .addSelect("COUNT(CASE WHEN log.severity = 'WARNING' THEN 1 END)", "warning")
        .groupBy("DATE(log.created_at)")
        .orderBy("date", "ASC")
        .getRawMany();

      // Get top actions
      const topActions = await queryBuilder
        .select("log.action", "action")
        .addSelect("COUNT(*)", "count")
        .groupBy("log.action")
        .orderBy("count", "DESC")
        .limit(10)
        .getRawMany();

      // Get user activity
      const userActivity = await queryBuilder
        .leftJoin("log.user", "user")
        .select("log.user_id", "userId")
        .addSelect("user.email", "email")
        .addSelect("user.first_name", "firstName")
        .addSelect("user.last_name", "lastName")
        .addSelect("COUNT(*)", "count")
        .addSelect("MAX(log.created_at)", "lastActive")
        .where("log.user_id IS NOT NULL")
        .groupBy("log.user_id, user.email, user.first_name, user.last_name")
        .orderBy("count", "DESC")
        .limit(10)
        .getRawMany();

      res.json({
        success: true,
        data: {
          daily_counts: dailyCounts,
          top_actions: topActions,
          user_activity: userActivity,
          period_days: Number(days),
        },
      });
    } catch (error: any) {
      console.error("❌ Get audit log summary error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch audit log summary",
        error: error.message,
      });
    }
  }

  static async getAuditLogDetails(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const auditRepo = dbConnection.getRepository(AuditLog);
      const log = await auditRepo.findOne({
        where: { id: id as string },
        relations: ["user", "institution"],
      });

      if (!log) {
        return res.status(404).json({
          success: false,
          message: "Audit log not found",
        });
      }

      res.json({
        success: true,
        data: log,
      });
    } catch (error: any) {
      console.error("❌ Get audit log details error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch audit log details",
        error: error.message,
      });
    }
  }

  static async getUserAuditTrail(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      const auditRepo = dbConnection.getRepository(AuditLog);
      const logs = await auditRepo.find({
        where: { user_id: userId as string },
        order: { created_at: "DESC" },
        take: Number(limit),
        skip: Number(offset),
      });

      const total = await auditRepo.count({ where: { user_id: userId as string } });

      res.json({
        success: true,
        data: {
          logs,
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error: any) {
      console.error("❌ Get user audit trail error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user audit trail",
        error: error.message,
      });
    }
  }

  static async getInstitutionAuditTrail(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;
      const { page = 1, limit = 50, startDate, endDate } = req.query;

      const auditRepo = dbConnection.getRepository(AuditLog);
      const queryBuilder = auditRepo.createQueryBuilder("log")
        .leftJoinAndSelect("log.user", "user")
        .where("log.institution_id = :institutionId", { institutionId });

      if (startDate) {
        queryBuilder.andWhere("log.created_at >= :startDate", { startDate: new Date(startDate as string) });
      }

      if (endDate) {
        queryBuilder.andWhere("log.created_at <= :endDate", { endDate: new Date(endDate as string) });
      }

      const total = await queryBuilder.getCount();

      const logs = await queryBuilder
        .orderBy("log.created_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get institution audit trail error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch institution audit trail",
        error: error.message,
      });
    }
  }

  static async clearAuditLogs(req: Request, res: Response) {
    try {
      const { olderThan } = req.query;
      
      if (!olderThan) {
        return res.status(400).json({
          success: false,
          message: "olderThan parameter is required (e.g., 90d)",
        });
      }

      const days = parseInt(olderThan as string);
      if (isNaN(days)) {
        return res.status(400).json({
          success: false,
          message: "Invalid days value",
        });
      }

      const cutoffDate = subDays(new Date(), days);
      
      const auditRepo = dbConnection.getRepository(AuditLog);
      const result = await auditRepo
        .createQueryBuilder()
        .delete()
        .where("created_at < :cutoffDate", { cutoffDate })
        .execute();

      // Log this action
      await AuditLogService.logWithRequest(req, AuditLogAction.SYSTEM_SETTINGS_UPDATED, {
        action: AuditLogAction.SYSTEM_SETTINGS_UPDATED,
        metadata: {
          action: "clear_audit_logs",
          older_than_days: days,
          records_deleted: result.affected,
        },
      });

      res.json({
        success: true,
        message: `Cleared ${result.affected} audit logs older than ${days} days`,
        data: {
          records_deleted: result.affected,
        },
      });
    } catch (error: any) {
      console.error("❌ Clear audit logs error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to clear audit logs",
        error: error.message,
      });
    }
  }
}