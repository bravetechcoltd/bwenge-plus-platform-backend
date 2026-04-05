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

export enum NotificationType {
  // Learner notifications
  ENROLLMENT_APPROVED = "ENROLLMENT_APPROVED",
  ENROLLMENT_REJECTED = "ENROLLMENT_REJECTED",
  ENROLLMENT_PENDING = "ENROLLMENT_PENDING",
  ASSESSMENT_GRADED = "ASSESSMENT_GRADED",
  NEW_LESSON_PUBLISHED = "NEW_LESSON_PUBLISHED",
  CERTIFICATE_ISSUED = "CERTIFICATE_ISSUED",
  COURSE_DEADLINE_REMINDER = "COURSE_DEADLINE_REMINDER",

  // Institution Admin notifications
  NEW_ENROLLMENT_REQUEST = "NEW_ENROLLMENT_REQUEST",
  NEW_INSTRUCTOR_JOINED = "NEW_INSTRUCTOR_JOINED",
  NEW_STUDENT_JOINED = "NEW_STUDENT_JOINED",
  COURSE_PUBLISHED = "COURSE_PUBLISHED",
  COURSE_FLAGGED = "COURSE_FLAGGED",
  BULK_ENROLLMENT_COMPLETED = "BULK_ENROLLMENT_COMPLETED",
  ACCESS_CODE_USED = "ACCESS_CODE_USED",

  // System Admin notifications
  NEW_INSTITUTION_REGISTRATION = "NEW_INSTITUTION_REGISTRATION",
  NEW_INSTITUTION_ADMIN = "NEW_INSTITUTION_ADMIN",
  CONTENT_MODERATION_FLAG = "CONTENT_MODERATION_FLAG",
  SYSTEM_HEALTH_ALERT = "SYSTEM_HEALTH_ALERT",
  ENROLLMENT_SPIKE = "ENROLLMENT_SPIKE",
  NEW_INSTRUCTOR_APPLICATION = "NEW_INSTRUCTOR_APPLICATION",
}

export enum NotificationEntityType {
  ENROLLMENT = "ENROLLMENT",
  COURSE = "COURSE",
  INSTITUTION = "INSTITUTION",
  USER = "USER",
  ASSESSMENT = "ASSESSMENT",
  CERTIFICATE = "CERTIFICATE",
  SYSTEM = "SYSTEM",
}

export enum RecipientRole {
  SYSTEM_ADMIN = "SYSTEM_ADMIN",
  INSTITUTION_ADMIN = "INSTITUTION_ADMIN",
  INSTRUCTOR = "INSTRUCTOR",
  LEARNER = "LEARNER",
}

@Entity("notifications")
@Index(["recipient_user_id", "is_read"])
@Index(["recipient_user_id", "created_at"])
export class Notification {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("uuid")
  @Index()
  recipient_user_id: string;

@ManyToOne(() => User, { onDelete: "CASCADE", nullable: true })
@JoinColumn({ name: "recipient_user_id" })
recipient: User;

  @Column({
    type: "enum",
    enum: RecipientRole,
  })
  recipient_role: RecipientRole;

  @Column({
    type: "enum",
    enum: NotificationType,
  })
  notification_type: NotificationType;

  @Column({ type: "varchar", length: 255 })
  title: string;

  @Column({ type: "text" })
  body: string;

  @Column({
    type: "enum",
    enum: NotificationEntityType,
  })
  entity_type: NotificationEntityType;

  @Column({ type: "uuid", nullable: true })
  entity_id: string;

  @Column({ default: false })
  is_read: boolean;

  @Column({ type: "timestamp", nullable: true })
  read_at: Date;

  @Column({ type: "uuid", nullable: true })
  actor_user_id: string;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "actor_user_id" })
  actor: User;

  @Column({ type: "uuid", nullable: true })
  @Index()
  institution_id: string;

  @CreateDateColumn()
  created_at: Date;
}
