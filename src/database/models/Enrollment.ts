
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";
import { Course } from "./Course";
import { LessonProgress } from "./LessonProgress";
import { Progress } from "./Progress";

export enum EnrollmentStatus {
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  DROPPED = "DROPPED",
  EXPIRED = "EXPIRED",
  PENDING = "PENDING",
}

export enum EnrollmentApprovalStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export enum EnrollmentRequestType {
  ACCESS_CODE_REQUEST = "ACCESS_CODE_REQUEST",
  APPROVAL_REQUEST = "APPROVAL_REQUEST",
}

@Entity("enrollments")
export class Enrollment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("uuid")
  @Index()
  user_id: string;

  @ManyToOne(() => User, (user) => user.enrollments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column("uuid")
  @Index()
  course_id: string;

  @ManyToOne(() => Course, (course) => course.enrollments, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "course_id" })
  course: Course;

  // ==================== ENHANCEMENTS ====================
  @Column({ nullable: true })
  access_code_used: string;

  @Column({ default: false })
  requires_approval: boolean;

  @Column({
    type: "enum",
    enum: EnrollmentApprovalStatus,
    nullable: true,
  })
  approval_status: EnrollmentApprovalStatus;

  @Column({ type: "uuid", nullable: true })
  approved_by_user_id: string;

  @Column({ type: "timestamp", nullable: true })
  approval_date: Date;

  @Column({ type: "uuid", nullable: true })
  institution_id: string;

  // NEW: Request type to distinguish between access code requests and approval requests
  @Column({
    type: "enum",
    enum: EnrollmentRequestType,
    nullable: true,
  })
  request_type: EnrollmentRequestType;

  // NEW: Message from learner when requesting access code
  @Column({ type: "text", nullable: true })
  request_message: string;

  // NEW: Flag to track if access code has been sent
  @Column({ default: false })
  access_code_sent: boolean;

  // NEW: Timestamp when access code was sent
  @Column({ type: "timestamp", nullable: true })
  access_code_sent_at: Date;

  // Existing fields preserved
  @CreateDateColumn()
  enrolled_at: Date;

  @Column({ type: "integer", default: 0 })
  progress_percentage: number;

  @Column({
    type: "enum",
    enum: EnrollmentStatus,
    default: EnrollmentStatus.ACTIVE,
  })
  status: EnrollmentStatus;

  @Column({ type: "timestamp", nullable: true })
  completion_date: Date;

  @Column({ default: false })
  certificate_issued: boolean;

  @Column({ type: "integer", default: 0 })
  total_time_spent_minutes: number;

  @Column({ type: "timestamp", nullable: true })
  last_accessed: Date;

  @Column({ type: "integer", default: 0 })
  completed_lessons: number;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  final_score: number;

  @OneToMany(() => LessonProgress, (lessonProgress) => lessonProgress.enrollment)
  lesson_progress: LessonProgress[];

  @OneToMany(() => Progress, (progress) => progress.enrollment)
  progress_records: Progress[];
  
  @UpdateDateColumn()
  updated_at: Date;
}