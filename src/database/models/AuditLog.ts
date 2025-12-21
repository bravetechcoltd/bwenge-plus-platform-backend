import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";
import { Institution } from "./Institution";

export enum AuditLogAction {
  // Authentication & Authorization
  USER_LOGIN = "USER_LOGIN",
  USER_LOGOUT = "USER_LOGOUT",
  LOGIN_FAILED = "LOGIN_FAILED",
  PASSWORD_CHANGE = "PASSWORD_CHANGE",
  PASSWORD_RESET = "PASSWORD_RESET",
  TWO_FACTOR_ENABLED = "TWO_FACTOR_ENABLED",
  TWO_FACTOR_DISABLED = "TWO_FACTOR_DISABLED",
  
  // User Management
  USER_CREATED = "USER_CREATED",
  USER_UPDATED = "USER_UPDATED",
  USER_DELETED = "USER_DELETED",
  USER_ACTIVATED = "USER_ACTIVATED",
  USER_DEACTIVATED = "USER_DEACTIVATED",
  ROLE_ASSIGNED = "ROLE_ASSIGNED",
  ROLE_REVOKED = "ROLE_REVOKED",
  
  // Institution Management
  INSTITUTION_CREATED = "INSTITUTION_CREATED",
  INSTITUTION_UPDATED = "INSTITUTION_UPDATED",
  INSTITUTION_DELETED = "INSTITUTION_DELETED",
  MEMBER_ADDED = "MEMBER_ADDED",
  MEMBER_REMOVED = "MEMBER_REMOVED",
  MEMBER_ROLE_UPDATED = "MEMBER_ROLE_UPDATED",
  
  // Course Management
  COURSE_CREATED = "COURSE_CREATED",
  COURSE_UPDATED = "COURSE_UPDATED",
  COURSE_DELETED = "COURSE_DELETED",
  COURSE_PUBLISHED = "COURSE_PUBLISHED",
  COURSE_UNPUBLISHED = "COURSE_UNPUBLISHED",
  
  // Enrollment Management
  ENROLLMENT_APPROVED = "ENROLLMENT_APPROVED",
  ENROLLMENT_REJECTED = "ENROLLMENT_REJECTED",
  ENROLLMENT_CANCELLED = "ENROLLMENT_CANCELLED",
  ACCESS_CODE_GENERATED = "ACCESS_CODE_GENERATED",
  ACCESS_CODE_USED = "ACCESS_CODE_USED",
  
  // System Settings
  SYSTEM_SETTINGS_UPDATED = "SYSTEM_SETTINGS_UPDATED",
  SECURITY_SETTINGS_UPDATED = "SECURITY_SETTINGS_UPDATED",
  ROLE_CREATED = "ROLE_CREATED",
  ROLE_UPDATED = "ROLE_UPDATED",
  ROLE_DELETED = "ROLE_DELETED",
  
  // Content Management
  CONTENT_CREATED = "CONTENT_CREATED",
  CONTENT_UPDATED = "CONTENT_UPDATED",
  CONTENT_DELETED = "CONTENT_DELETED",
  CONTENT_MODERATED = "CONTENT_MODERATED",
  
  // Security Events
  PERMISSION_CHANGED = "PERMISSION_CHANGED",
  API_KEY_GENERATED = "API_KEY_GENERATED",
  API_KEY_REVOKED = "API_KEY_REVOKED",
  SUSPICIOUS_ACTIVITY = "SUSPICIOUS_ACTIVITY",
  
  // Data Operations
  DATA_EXPORTED = "DATA_EXPORTED",
  DATA_IMPORTED = "DATA_IMPORTED",
  DATA_DELETED = "DATA_DELETED",
}

export enum AuditLogSeverity {
  INFO = "INFO",
  WARNING = "WARNING",
  ERROR = "ERROR",
  CRITICAL = "CRITICAL",
}

@Entity("audit_logs")
@Index(["user_id", "created_at"])
@Index(["institution_id", "created_at"])
@Index(["action", "created_at"])
@Index(["severity", "created_at"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  user_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user: User | null;

  @Column({ type: "uuid", nullable: true })
  @Index()
  institution_id: string | null;

  @ManyToOne(() => Institution, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "institution_id" })
  institution: Institution | null;

  @Column({
    type: "enum",
    enum: AuditLogAction,
  })
  @Index()
  action: AuditLogAction;

  @Column({
    type: "enum",
    enum: AuditLogSeverity,
    default: AuditLogSeverity.INFO,
  })
  @Index()
  severity: AuditLogSeverity;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "jsonb", nullable: true })
  metadata: {
    ip_address?: string;
    user_agent?: string;
    session_id?: string;
    request_method?: string;
    request_path?: string;
    response_status?: number;
    execution_time_ms?: number;
    affected_entity_id?: string;
    affected_entity_type?: string;
    changes?: Record<string, { old: any; new: any }>;
    error_message?: string;
    error_stack?: string;
    location?: {
      country?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
    };
  };

  @Column({ type: "text", nullable: true })
  ip_address: string;

  @Column({ type: "text", nullable: true })
  user_agent: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  session_token: string;

  @CreateDateColumn()
  @Index()
  created_at: Date;
}