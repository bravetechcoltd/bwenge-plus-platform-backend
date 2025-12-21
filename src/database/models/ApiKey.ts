
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import * as crypto from "crypto";

export enum ApiKeyStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  EXPIRED = "EXPIRED",
  REVOKED = "REVOKED",
}

export enum ApiKeyPermission {
  READ = "READ",
  WRITE = "WRITE",
  DELETE = "DELETE",
  ADMIN = "ADMIN",
  WEBHOOK = "WEBHOOK",
}

@Entity("api_keys")
export class ApiKey {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ unique: true })
  @Index()
  key_hash: string;

  @Column({ unique: true })
  @Index()
  key_preview: string; // First 8 characters for display

  @Column({
    type: "enum",
    enum: ApiKeyStatus,
    default: ApiKeyStatus.ACTIVE,
  })
  @Index()
  status: ApiKeyStatus;

  @Column({ type: "simple-array" })
  permissions: ApiKeyPermission[];

  @Column({ type: "jsonb", nullable: true })
  allowed_ips: string[];

  @Column({ type: "jsonb", nullable: true })
  allowed_domains: string[];

  @Column({ type: "jsonb", nullable: true })
  rate_limits: {
    window_ms: number;
    max_requests: number;
  };

  @Column({ type: "timestamp", nullable: true })
  expires_at: Date;

  @Column({ type: "timestamp", nullable: true })
  last_used_at: Date;

  @Column({ default: 0 })
  total_requests: number;

  @Column({ type: "uuid" })
  @Index()
  created_by_user_id: string;

  @Column({ type: "jsonb", nullable: true })
  metadata: {
    contact_email?: string;
    contact_name?: string;
    purpose?: string;
    environment?: "development" | "staging" | "production";
  };

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Helper to generate a new API key
  static generateKey(): { key: string; hash: string; preview: string } {
    const key = `bw_${crypto.randomBytes(24).toString("hex")}`;
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    const preview = key.substring(0, 12) + "...";
    return { key, hash, preview };
  }
}

@Entity("api_key_logs")
export class ApiKeyLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  @Index()
  api_key_id: string;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  @Index()
  timestamp: Date;

  @Column()
  endpoint: string;

  @Column()
  method: string;

  @Column({ type: "integer" })
  status_code: number;

  @Column({ nullable: true })
  ip_address: string;

  @Column({ type: "integer", default: 0 })
  response_time_ms: number;

  @Column({ nullable: true })
  user_agent: string;
}