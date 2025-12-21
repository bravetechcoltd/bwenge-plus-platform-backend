import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum BackupStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  RESTORING = "RESTORING",
}

export enum BackupType {
  FULL = "FULL",
  INCREMENTAL = "INCREMENTAL",
  SCHEMA = "SCHEMA",
  DATA = "DATA",
}

@Entity("database_backups")
export class DatabaseBackup {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  @Index()
  filename: string;

  @Column({
    type: "enum",
    enum: BackupType,
    default: BackupType.FULL,
  })
  type: BackupType;

  @Column({
    type: "enum",
    enum: BackupStatus,
    default: BackupStatus.PENDING,
  })
  @Index()
  status: BackupStatus;

  @Column({ type: "bigint", nullable: true })
  size_bytes: number;

  @Column({ nullable: true })
  storage_path: string;

  @Column({ nullable: true })
  public_url: string;

  @Column({ type: "jsonb", nullable: true })
  metadata: {
    tables_count?: number;
    row_count?: number;
    database_size?: string;
    version?: string;
    compression?: string;
    encryption?: string;
    checksum?: string;
  };

  @Column({ type: "timestamp", nullable: true })
  started_at: Date;

  @Column({ type: "timestamp", nullable: true })
  completed_at: Date;

  @Column({ type: "text", nullable: true })
  error_message: string;

  @Column({ type: "jsonb", nullable: true })
  log: string[];

  @Column({ default: false })
  is_automated: boolean;

  @Column({ nullable: true })
  @Index()
  created_by_user_id: string;

  @Column({ type: "timestamp", nullable: true })
  expires_at: Date;

  @CreateDateColumn()
  created_at: Date;
}

@Entity("database_health_checks")
export class DatabaseHealthCheck {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  @Index()
  checked_at: Date;

  @Column()
  status: "healthy" | "degraded" | "down";

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  cpu_usage_percent: number;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  memory_usage_percent: number;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  disk_usage_percent: number;

  @Column({ type: "integer", nullable: true })
  active_connections: number;

  @Column({ type: "integer", nullable: true })
  max_connections: number;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  cache_hit_ratio: number;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  index_hit_ratio: number;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  query_latency_ms: number;

  @Column({ type: "jsonb", nullable: true })
  table_stats: {
    table_name: string;
    row_count: number;
    size_mb: number;
    index_size_mb: number;
  }[];

  @Column({ type: "jsonb", nullable: true })
  slow_queries: {
    query: string;
    calls: number;
    total_time_ms: number;
    mean_time_ms: number;
  }[];

  @Column({ type: "text", nullable: true })
  error: string;
}