// backend/src/services/auditLogService.ts
import dbConnection from "../database/db";
import { AuditLog, AuditLogAction, AuditLogSeverity } from "../database/models/AuditLog";
import { Request } from "express";
import { emitToAdminRoom } from "../socket/socketEmitter";

interface LogOptions {
  userId?: string | null;
  institutionId?: string | null;
  action: AuditLogAction;
  severity?: AuditLogSeverity;
  description?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  sessionToken?: string;
}

export class AuditLogService {
  private static async getLocationFromIp(ip: string): Promise<any> {
    // In production, integrate with a geolocation service
    // For now, return null
    return null;
  }

  static async log(options: LogOptions): Promise<AuditLog> {
    try {
      const auditRepo = dbConnection.getRepository(AuditLog);
      
      // Get location if IP is provided
      let location = null;
      if (options.ipAddress && options.ipAddress !== '::1' && options.ipAddress !== '127.0.0.1') {
        location = await this.getLocationFromIp(options.ipAddress);
      }

      const auditLog = auditRepo.create({
        user_id: options.userId || null,
        institution_id: options.institutionId || null,
        action: options.action,
        severity: options.severity || AuditLogSeverity.INFO,
        description: options.description,
        metadata: {
          ...options.metadata,
          location,
        },
        ip_address: options.ipAddress,
        user_agent: options.userAgent,
        session_token: options.sessionToken,
      });

      const saved = await auditRepo.save(auditLog);

      // ── Real-time: Stream audit events to system admin dashboards ─────────
      emitToAdminRoom("new-audit-event", {
        id: saved.id,
        action: saved.action,
        severity: saved.severity,
        description: saved.description,
        userId: saved.user_id,
        timestamp: saved.created_at,
      });

      // ── Real-time: Security alert for critical severity ───────────────────
      if (saved.severity === AuditLogSeverity.CRITICAL || saved.severity === AuditLogSeverity.ERROR) {
        emitToAdminRoom("security-alert", {
          id: saved.id,
          action: saved.action,
          severity: saved.severity,
          description: saved.description,
          ipAddress: saved.ip_address,
          timestamp: saved.created_at,
        });
      }

      return saved;
    } catch (error) {
      // Don't throw - audit logging should not break the main flow
      return null as any;
    }
  }

  static async logWithRequest(
    req: Request,
    action: AuditLogAction,
    options: Omit<LogOptions, 'ipAddress' | 'userAgent' | 'sessionToken'>
  ): Promise<AuditLog> {
    const userId = (req.user as any)?.userId || (req.user as any)?.id;
    const sessionToken = req.cookies?.bwenge_token || req.headers.authorization?.split(' ')[1];

    return this.log({
      ...options,
      userId: options.userId !== undefined ? options.userId : userId,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      sessionToken,
    });
  }

  static async getUserActivity(
    userId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<AuditLog[]> {
    const auditRepo = dbConnection.getRepository(AuditLog);
    return await auditRepo.find({
      where: { user_id: userId },
      order: { created_at: "DESC" },
      take: limit,
      skip: offset,
    });
  }

  static async getInstitutionLogs(
    institutionId: string,
    filters: {
      startDate?: Date;
      endDate?: Date;
      actions?: AuditLogAction[];
      severity?: AuditLogSeverity[];
      userId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const auditRepo = dbConnection.getRepository(AuditLog);
    const queryBuilder = auditRepo.createQueryBuilder("log")
      .leftJoinAndSelect("log.user", "user")
      .where("log.institution_id = :institutionId", { institutionId });

    if (filters.startDate) {
      queryBuilder.andWhere("log.created_at >= :startDate", { startDate: filters.startDate });
    }

    if (filters.endDate) {
      queryBuilder.andWhere("log.created_at <= :endDate", { endDate: filters.endDate });
    }

    if (filters.actions && filters.actions.length > 0) {
      queryBuilder.andWhere("log.action IN (:...actions)", { actions: filters.actions });
    }

    if (filters.severity && filters.severity.length > 0) {
      queryBuilder.andWhere("log.severity IN (:...severity)", { severity: filters.severity });
    }

    if (filters.userId) {
      queryBuilder.andWhere("log.user_id = :userId", { userId: filters.userId });
    }

    const total = await queryBuilder.getCount();

    const logs = await queryBuilder
      .orderBy("log.created_at", "DESC")
      .take(filters.limit || 50)
      .skip(filters.offset || 0)
      .getMany();

    return { logs, total };
  }

  static async getSystemHealthLogs(
    days: number = 7,
    severity?: AuditLogSeverity[]
  ): Promise<AuditLog[]> {
    const auditRepo = dbConnection.getRepository(AuditLog);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const queryBuilder = auditRepo.createQueryBuilder("log")
      .where("log.created_at >= :startDate", { startDate })
      .andWhere("log.severity IN (:...severities)", {
        severities: severity || [AuditLogSeverity.ERROR, AuditLogSeverity.CRITICAL, AuditLogSeverity.WARNING]
      })
      .orderBy("log.created_at", "DESC");

    return await queryBuilder.getMany();
  }

  static async getActionStats(
    institutionId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Record<string, number>> {
    const auditRepo = dbConnection.getRepository(AuditLog);
    
    const stats = await auditRepo.createQueryBuilder("log")
      .select("log.action", "action")
      .addSelect("COUNT(*)", "count")
      .where("log.institution_id = :institutionId", { institutionId })
      .andWhere("log.created_at BETWEEN :startDate AND :endDate", { startDate, endDate })
      .groupBy("log.action")
      .getRawMany();

    return stats.reduce((acc, { action, count }) => {
      acc[action] = parseInt(count);
      return acc;
    }, {} as Record<string, number>);
  }
}