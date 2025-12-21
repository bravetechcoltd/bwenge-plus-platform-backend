import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum AnalyticsEventType {
  USER_LOGIN = "USER_LOGIN",
  USER_REGISTER = "USER_REGISTER",
  COURSE_VIEW = "COURSE_VIEW",
  COURSE_ENROLL = "COURSE_ENROLL",
  COURSE_COMPLETE = "COURSE_COMPLETE",
  LESSON_COMPLETE = "LESSON_COMPLETE",
  QUIZ_ATTEMPT = "QUIZ_ATTEMPT",
  QUIZ_COMPLETE = "QUIZ_COMPLETE",
  CERTIFICATE_ISSUED = "CERTIFICATE_ISSUED",
  PAYMENT_START = "PAYMENT_START",
  PAYMENT_SUCCESS = "PAYMENT_SUCCESS",
  PAYMENT_FAIL = "PAYMENT_FAIL",
  REFUND_ISSUED = "REFUND_ISSUED",
  REVIEW_CREATED = "REVIEW_CREATED",
  SEARCH_PERFORMED = "SEARCH_PERFORMED",
  API_CALL = "API_CALL",
  ERROR_OCCURRED = "ERROR_OCCURRED",
}

@Entity("system_analytics_events")
@Index(["event_type", "timestamp"])
@Index(["user_id", "timestamp"])
export class SystemAnalyticsEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    type: "enum",
    enum: AnalyticsEventType,
  })
  @Index()
  event_type: AnalyticsEventType;

  @Column({ type: "uuid", nullable: true })
  @Index()
  user_id: string;

  @Column({ nullable: true })
  session_id: string;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  @Index()
  timestamp: Date;

  @Column({ type: "jsonb", nullable: true })
  properties: any;

  @Column({ type: "jsonb", nullable: true })
  context: {
    ip?: string;
    user_agent?: string;
    referrer?: string;
    url?: string;
    device?: string;
    browser?: string;
    os?: string;
    country?: string;
    city?: string;
  };

  @Column({ type: "decimal", precision: 10, scale: 3, nullable: true })
  value: number;

  @Column({ nullable: true })
  @Index()
  course_id: string;

  @Column({ nullable: true })
  @Index()
  institution_id: string;
}

@Entity("system_analytics_daily")
@Index(["date", "metric_name"])
export class SystemAnalyticsDaily {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "date" })
  @Index()
  date: Date;

  @Column()
  @Index()
  metric_name: string;

  @Column({ nullable: true })
  @Index()
  dimension: string;

  @Column({ nullable: true })
  @Index()
  dimension_value: string;

  @Column({ type: "bigint" })
  count: number;

  @Column({ type: "decimal", precision: 15, scale: 2, nullable: true })
  sum: number;

  @Column({ type: "decimal", precision: 15, scale: 2, nullable: true })
  avg: number;

  @Column({ type: "decimal", precision: 15, scale: 2, nullable: true })
  min: number;

  @Column({ type: "decimal", precision: 15, scale: 2, nullable: true })
  max: number;

  @Column({ type: "jsonb", nullable: true })
  breakdown: Record<string, number>;

  @CreateDateColumn()
  created_at: Date;
}