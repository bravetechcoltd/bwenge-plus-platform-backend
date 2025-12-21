import dbConnection from "../database/db";
import { SystemHealth, HealthCheckType, HealthStatus } from "../database/models/SystemHealth";
import { User } from "../database/models/User";
import { Course, CourseStatus } from "../database/models/Course";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { MoreThan } from "typeorm";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import axios from "axios";

const execAsync = promisify(exec);

interface HealthCheckResult {
  type: HealthCheckType;
  status: HealthStatus;
  responseTimeMs: number;
  metrics?: Record<string, any>;
  message?: string;
  issues?: Array<{
    component: string;
    severity: "low" | "medium" | "high" | "critical";
    message: string;
    timestamp: Date;
  }>;
}

export class SystemHealthService {
  private static async checkDatabase(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const userRepo = dbConnection.getRepository(User);
      await userRepo.findOne({ where: {}, select: ["id"] });
      
      return {
        type: HealthCheckType.DATABASE,
        status: HealthStatus.HEALTHY,
        responseTimeMs: Date.now() - start,
        metrics: {
          connection_count: (dbConnection as any).driver?.pool?.length || 0,
        },
      };
    } catch (error:any) {
      return {
        type: HealthCheckType.DATABASE,
        status: HealthStatus.UNHEALTHY,
        responseTimeMs: Date.now() - start,
        message: error.message,
        issues: [{
          component: "Database Connection",
          severity: "critical",
          message: error.message,
          timestamp: new Date(),
        }],
      };
    }
  }

  private static async checkStorage(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const { stdout } = await execAsync("df -k . | tail -1 | awk '{print $5 \" \" $2 \" \" $3}'");
      const [usagePercent, total, used] = stdout.trim().split(' ').map(s => parseInt(s.replace('%', '')));
      
      const usage = (used / total) * 100;
      let status = HealthStatus.HEALTHY;
      const issues: Array<{
        component: string;
        severity: "low" | "medium" | "high" | "critical";
        message: string;
        timestamp: Date;
      }> = [];

      if (usage > 90) {
        status = HealthStatus.UNHEALTHY;
        issues.push({
          component: "Disk Space",
          severity: "critical" as const,
          message: `Disk usage at ${usage.toFixed(1)}%`,
          timestamp: new Date(),
        });
      } else if (usage > 80) {
        status = HealthStatus.DEGRADED;
        issues.push({
          component: "Disk Space",
          severity: "high" as const,
          message: `Disk usage at ${usage.toFixed(1)}%`,
          timestamp: new Date(),
        });
      }

      return {
        type: HealthCheckType.STORAGE,
        status,
        responseTimeMs: Date.now() - start,
        metrics: {
          total_gb: Math.round(total / (1024 * 1024)),
          used_gb: Math.round(used / (1024 * 1024)),
          usage_percent: usage,
        },
        issues,
      };
    } catch (error: any) {
      return {
        type: HealthCheckType.STORAGE,
        status: HealthStatus.DEGRADED,
        responseTimeMs: Date.now() - start,
        message: "Could not check disk usage",
        issues: [{
          component: "Storage Check",
          severity: "medium" as const,
          message: error.message,
          timestamp: new Date(),
        }],
      };
    }
  }

  private static async checkSystemResources(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
      const totalMem = os.totalmem() / (1024 * 1024 * 1024);
      const freeMem = os.freemem() / (1024 * 1024 * 1024);
      const memUsage = ((totalMem - freeMem) / totalMem) * 100;
      
      let status = HealthStatus.HEALTHY;
      const issues: Array<{
        component: string;
        severity: "low" | "medium" | "high" | "critical";
        message: string;
        timestamp: Date;
      }> = [];

      if (cpuUsage > 90) {
        status = HealthStatus.DEGRADED;
        issues.push({
          component: "CPU",
          severity: "high" as const,
          message: `CPU usage at ${cpuUsage.toFixed(1)}%`,
          timestamp: new Date(),
        });
      }

      if (memUsage > 90) {
        status = HealthStatus.DEGRADED;
        issues.push({
          component: "Memory",
          severity: "high" as const,
          message: `Memory usage at ${memUsage.toFixed(1)}%`,
          timestamp: new Date(),
        });
      }

      return {
        type: HealthCheckType.API,
        status,
        responseTimeMs: Date.now() - start,
        metrics: {
          cpu_usage: cpuUsage,
          memory_usage: memUsage,
          total_memory_gb: totalMem,
          free_memory_gb: freeMem,
          uptime_hours: Math.round(os.uptime() / 3600),
          load_average: os.loadavg(),
        },
        issues,
      };
    } catch (error: any) {
      return {
        type: HealthCheckType.API,
        status: HealthStatus.DEGRADED,
        responseTimeMs: Date.now() - start,
        message: error.message,
        issues: [{
          component: "System Resources",
          severity: "medium" as const,
          message: error.message,
          timestamp: new Date(),
        }],
      };
    }
  }

  private static async checkCloudinary(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // Simple ping to Cloudinary - in production, use their SDK's ping method
      const response = await axios.get('https://api.cloudinary.com/v1_1/' + process.env.CLOUDINARY_CLOUD_NAME + '/ping', {
        timeout: 5000,
      });
      
      return {
        type: HealthCheckType.CLOUDINARY,
        status: response.status === 200 ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
        responseTimeMs: Date.now() - start,
      };
    } catch (error:any) {
      return {
        type: HealthCheckType.CLOUDINARY,
        status: HealthStatus.UNHEALTHY,
        responseTimeMs: Date.now() - start,
        message: error.message,
        issues: [{
          component: "Cloudinary",
          severity: "high",
          message: error.message,
          timestamp: new Date(),
        }],
      };
    }
  }

  private static async checkEmailService(): Promise<HealthCheckResult> {
    const start = Date.now();
    // In production, actually try to send a test email or ping the service
    return {
      type: HealthCheckType.EMAIL,
      status: HealthStatus.HEALTHY,
      responseTimeMs: Date.now() - start,
      metrics: {
        provider: process.env.EMAIL_PROVIDER || "smtp",
      },
    };
  }

  static async runFullHealthCheck(): Promise<SystemHealth[]> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
      this.checkSystemResources(),
      this.checkCloudinary(),
      this.checkEmailService(),
    ]);

    const healthRepo = dbConnection.getRepository(SystemHealth);
    const results: SystemHealth[] = [];

    for (const check of checks) {
      const healthRecord = healthRepo.create({
        type: check.type,
        status: check.status,
        response_time_ms: check.responseTimeMs,
        metrics: check.metrics,
        message: check.message,
        issues: check.issues,
      });
      
      const saved = await healthRepo.save(healthRecord);
      results.push(saved);
    }

    return results;
  }

  static async getLatestHealthStatus(): Promise<SystemHealth[]> {
    const healthRepo = dbConnection.getRepository(SystemHealth);
    
    // Get the most recent record for each type
    const types = Object.values(HealthCheckType);
    const results: SystemHealth[] = [];

    for (const type of types) {
      const latest = await healthRepo.findOne({
        where: { type },
        order: { created_at: "DESC" },
      });
      if (latest) {
        results.push(latest);
      }
    }

    return results;
  }

  static async getHealthHistory(
    type?: HealthCheckType,
    hours: number = 24
  ): Promise<SystemHealth[]> {
    const healthRepo = dbConnection.getRepository(SystemHealth);
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const queryBuilder = healthRepo.createQueryBuilder("health")
      .where("health.created_at >= :startDate", { startDate });

    if (type) {
      queryBuilder.andWhere("health.type = :type", { type });
    }

    return await queryBuilder
      .orderBy("health.created_at", "DESC")
      .getMany();
  }

  static async getSystemMetrics(): Promise<{
    activeUsers: number;
    activeCourses: number;
    activeEnrollments: number;
    databaseSize?: number;
    responseTimeAvg: number;
  }> {
    const userRepo = dbConnection.getRepository(User);
    const courseRepo = dbConnection.getRepository(Course);
    const enrollmentRepo = dbConnection.getRepository(Enrollment);

    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const [activeUsers, activeCourses, activeEnrollments] = await Promise.all([
      userRepo.count({ where: { isUserLogin: true, last_login: MoreThan(oneHourAgo) } }),
      courseRepo.count({ where: { status: CourseStatus.PUBLISHED } }),
      enrollmentRepo.count({ where: { status: EnrollmentStatus.ACTIVE } }),
    ]);

    // Get average response time from recent health checks
    const healthRepo = dbConnection.getRepository(SystemHealth);
    const recentChecks = await healthRepo.find({
      take: 100,
      order: { created_at: "DESC" },
    });

    const avgResponseTime = recentChecks.length > 0
      ? recentChecks.reduce((sum, h) => sum + (h.response_time_ms || 0), 0) / recentChecks.length
      : 0;

    return {
      activeUsers,
      activeCourses,
      activeEnrollments,
      responseTimeAvg: Math.round(avgResponseTime),
    };
  }
}