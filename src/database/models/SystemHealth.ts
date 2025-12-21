// backend/src/database/models/SystemHealth.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum HealthCheckType {
  DATABASE = "DATABASE",
  REDIS = "REDIS",
  STORAGE = "STORAGE",
  EMAIL = "EMAIL",
  API = "API",
  AUTHENTICATION = "AUTHENTICATION",
  PAYMENT = "PAYMENT",
  CDN = "CDN",
  CLOUDINARY = "CLOUDINARY",
  EXTERNAL_SERVICES = "EXTERNAL_SERVICES",
}

export enum HealthStatus {
  HEALTHY = "HEALTHY",
  DEGRADED = "DEGRADED",
  UNHEALTHY = "UNHEALTHY",
  MAINTENANCE = "MAINTENANCE",
}

@Entity("system_health")
@Index(["type", "created_at"])
export class SystemHealth {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    type: "enum",
    enum: HealthCheckType,
  })
  @Index()
  type: HealthCheckType;

  @Column({
    type: "enum",
    enum: HealthStatus,
    default: HealthStatus.HEALTHY,
  })
  status: HealthStatus;

  @Column({ type: "float", nullable: true })
  response_time_ms: number;

  @Column({ type: "jsonb", nullable: true })
  metrics: {
    uptime?: number;
    cpu_usage?: number;
    memory_usage?: number;
    disk_usage?: number;
    connection_count?: number;
    active_connections?: number;
    query_performance?: number;
    cache_hit_rate?: number;
    error_rate?: number;
    request_rate?: number;
  };

  @Column({ type: "text", nullable: true })
  message: string;

  @Column({ type: "jsonb", nullable: true })
  details: Record<string, any>;

  @Column({ type: "jsonb", nullable: true })
  issues: Array<{
    component: string;
    severity: "low" | "medium" | "high" | "critical";
    message: string;
    timestamp: Date;
  }>;

  @CreateDateColumn()
  @Index()
  created_at: Date;
}