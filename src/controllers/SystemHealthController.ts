// backend/src/controllers/SystemHealthController.ts
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { SystemHealth, HealthCheckType, HealthStatus } from "../database/models/SystemHealth";
import { SystemHealthService } from "../services/systemHealthService";
import { AuditLogService } from "../services/auditLogService";
import { AuditLogAction } from "../database/models/AuditLog";
import { Between, LessThan, MoreThan } from "typeorm";
import { subHours, subDays, format } from "date-fns";

export class SystemHealthController {
  static async getSystemHealth(req: Request, res: Response) {
    try {
      const healthStatus = await SystemHealthService.getLatestHealthStatus();

      // Calculate overall status
      let overallStatus = HealthStatus.HEALTHY;
      const issues: any[] = [];

      for (const check of healthStatus) {
        if (check.status === HealthStatus.UNHEALTHY) {
          overallStatus = HealthStatus.UNHEALTHY;
          issues.push(...(check.issues || []));
        } else if (check.status === HealthStatus.DEGRADED && overallStatus === HealthStatus.HEALTHY) {
          overallStatus = HealthStatus.DEGRADED;
          issues.push(...(check.issues || []));
        }
      }

      // Get system metrics
      const metrics = await SystemHealthService.getSystemMetrics();

      res.json({
        success: true,
        data: {
          overall_status: overallStatus,
          last_updated: healthStatus.length > 0 ? healthStatus[0].created_at : new Date(),
          checks: healthStatus,
          issues,
          metrics,
        },
      });
    } catch (error: any) {
      console.error("❌ Get system health error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch system health",
        error: error.message,
      });
    }
  }

  static async runHealthCheck(req: Request, res: Response) {
    try {
      const results = await SystemHealthService.runFullHealthCheck();

      // Log this action
      await AuditLogService.logWithRequest(req, AuditLogAction.SYSTEM_SETTINGS_UPDATED, {
        action: AuditLogAction.SYSTEM_SETTINGS_UPDATED,
        metadata: {
          action: "manual_health_check",
          results: results.map(r => ({ type: r.type, status: r.status })),
        },
      });

      res.json({
        success: true,
        message: "Health check completed",
        data: results,
      });
    } catch (error: any) {
      console.error("❌ Run health check error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to run health check",
        error: error.message,
      });
    }
  }

  static async getHealthHistory(req: Request, res: Response) {
    try {
      const { type, hours = 24 } = req.query;

      const history = await SystemHealthService.getHealthHistory(
        type as HealthCheckType,
        Number(hours)
      );

      // Group by type for charting
      const grouped = history.reduce((acc, record) => {
        if (!acc[record.type]) {
          acc[record.type] = [];
        }
        acc[record.type].push({
          time: record.created_at,
          status: record.status,
          response_time: record.response_time_ms,
        });
        return acc;
      }, {} as Record<string, any[]>);

      res.json({
        success: true,
        data: {
          history,
          grouped,
          period_hours: Number(hours),
        },
      });
    } catch (error: any) {
      console.error("❌ Get health history error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch health history",
        error: error.message,
      });
    }
  }

  static async getSystemMetrics(req: Request, res: Response) {
    try {
      const { period = '24h' } = req.query;

      let startDate: Date;
      const endDate = new Date();

      switch (period) {
        case '1h':
          startDate = subHours(endDate, 1);
          break;
        case '24h':
          startDate = subHours(endDate, 24);
          break;
        case '7d':
          startDate = subDays(endDate, 7);
          break;
        case '30d':
          startDate = subDays(endDate, 30);
          break;
        default:
          startDate = subHours(endDate, 24);
      }

      const healthRepo = dbConnection.getRepository(SystemHealth);
      const metrics = await healthRepo.find({
        where: { created_at: Between(startDate, endDate) },
        order: { created_at: "ASC" },
      });

      // Calculate averages
      const avgResponseTime = metrics.length > 0
        ? metrics.reduce((sum, m) => sum + (m.response_time_ms || 0), 0) / metrics.length
        : 0;

      const statusCounts = metrics.reduce((acc, m) => {
        acc[m.status] = (acc[m.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      res.json({
        success: true,
        data: {
          period,
          start_date: startDate,
          end_date: endDate,
          metrics: {
            average_response_time_ms: Math.round(avgResponseTime),
            total_checks: metrics.length,
            status_distribution: statusCounts,
            timeline: metrics.map(m => ({
              time: m.created_at,
              type: m.type,
              status: m.status,
              response_time: m.response_time_ms,
            })),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get system metrics error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch system metrics",
        error: error.message,
      });
    }
  }

  static async getComponentHealth(req: Request, res: Response) {
    try {
      const { component } = req.params;

      const componentType = (component as string).toUpperCase() as HealthCheckType;
      if (!Object.values(HealthCheckType).includes(componentType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid component type",
        });
      }

      const healthRepo = dbConnection.getRepository(SystemHealth);
      const latest = await healthRepo.findOne({
        where: { type: componentType },
        order: { created_at: "DESC" },
      });

      const history = await healthRepo.find({
        where: { type: componentType },
        order: { created_at: "DESC" },
        take: 100,
      });

      res.json({
        success: true,
        data: {
          component: componentType,
          current: latest,
          history,
        },
      });
    } catch (error: any) {
      console.error("❌ Get component health error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch component health",
        error: error.message,
      });
    }
  }

  static async getIncidentHistory(req: Request, res: Response) {
    try {
      const { days = 30 } = req.query;

      const startDate = subDays(new Date(), Number(days));

      const healthRepo = dbConnection.getRepository(SystemHealth);
      const incidents = await healthRepo.find({
        where: [
          { status: HealthStatus.UNHEALTHY, created_at: MoreThan(startDate) },
          { status: HealthStatus.DEGRADED, created_at: MoreThan(startDate) },
        ],
        order: { created_at: "DESC" },
      });

      // Group by date
      const byDate = incidents.reduce((acc, incident) => {
        const date = format(incident.created_at, 'yyyy-MM-dd');
        if (!acc[date]) {
          acc[date] = [];
        }
        acc[date].push(incident);
        return acc;
      }, {} as Record<string, any[]>);

      res.json({
        success: true,
        data: {
          total_incidents: incidents.length,
          period_days: Number(days),
          by_date: byDate,
          incidents,
        },
      });
    } catch (error: any) {
      console.error("❌ Get incident history error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch incident history",
        error: error.message,
      });
    }
  }

  static async acknowledgeIncident(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      const healthRepo = dbConnection.getRepository(SystemHealth);
      const incident = await healthRepo.findOne({ where: { id: id as string } });

      if (!incident) {
        return res.status(404).json({
          success: false,
          message: "Incident not found",
        });
      }

      // Log acknowledgment
      await AuditLogService.logWithRequest(req, AuditLogAction.SYSTEM_SETTINGS_UPDATED, {
        action: AuditLogAction.SYSTEM_SETTINGS_UPDATED,
        metadata: {
          action: "acknowledge_incident",
          incident_id: id,
          incident_type: incident.type,
          incident_status: incident.status,
        },
      });

      res.json({
        success: true,
        message: "Incident acknowledged",
      });
    } catch (error: any) {
      console.error("❌ Acknowledge incident error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to acknowledge incident",
        error: error.message,
      });
    }
  }
}