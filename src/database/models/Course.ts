import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";
import { Lesson } from "./Lesson";
import { Enrollment } from "./Enrollment";
import { Certificate } from "./Certificate";
import { Institution } from "./Institution";
import { CourseCategory } from "./CourseCategory";
import { Module } from "./Module";
import { CourseInstructor } from "./CourseInstructor";
import { Review } from "./ReviewModel";
import { Progress } from "./Progress";
import { Space } from "./SpaceModel";

export enum CourseType {
  MOOC = "MOOC",
  SPOC = "SPOC",
}

export enum CourseLevel {
  BEGINNER = "BEGINNER",
  INTERMEDIATE = "INTERMEDIATE",
  ADVANCED = "ADVANCED",
  EXPERT = "EXPERT",
}

export enum CourseStatus {
  DRAFT = "DRAFT",
  PUBLISHED = "PUBLISHED",
  ARCHIVED = "ARCHIVED",
}

export enum ApprovalStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

@Entity("courses")
export class Course {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  title: string;

  @Column("text")
  description: string;

  @Column({ nullable: true })
  short_description: string;

  @Column({ nullable: true })
  thumbnail_url: string;

  @Column({ nullable: true })
  category: string;

  @Column({ type: "simple-array", nullable: true })
  tags: string[];

  // ==================== INSTRUCTOR ASSIGNMENT ====================
  // System Admin can assign any instructor
  // Institution Admin becomes instructor by default unless they assign another
  @Column({ type: "uuid", nullable: true })
  @Index()
  instructor_id: string | null;

  @ManyToOne(() => User, (user) => user.courses_created, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "instructor_id" })
  instructor: User | null;

  // ==================== NEW: INSTITUTION ADMIN TRACKING ====================
  // Tracks which Institution Admin created the course (for SPOC courses)
  @Column({ type: "uuid", nullable: true })
  @Index()
  created_by_institution_admin_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_institution_admin_id" })
  created_by_admin: User | null;

  // ==================== INSTITUTION SUPPORT ====================
  @Column({ type: "uuid", nullable: true })
  @Index()
  institution_id: string;

  @ManyToOne(() => Institution, (institution) => institution.courses, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "institution_id" })
  institution: Institution;

  @Column({ type: "uuid", nullable: true })
  @Index()
  category_id: string;

  @ManyToOne(() => CourseCategory, (category) => category.courses, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "category_id" })
  course_category: CourseCategory;

  // ==================== COURSE TYPE & ACCESS CONTROL ====================
  @Column({
    type: "enum",
    enum: CourseType,
    default: CourseType.MOOC,
  })
  course_type: CourseType;

  @Column({ default: true })
  is_public: boolean;

  @Column({ type: "simple-array", nullable: true })
  access_codes: string[];

  @Column({ default: false })
  requires_approval: boolean;

  @Column({ type: "integer", nullable: true })
  max_enrollments: number;

  @Column({ type: "timestamp", nullable: true })
  enrollment_start_date: Date;

  @Column({ type: "timestamp", nullable: true })
  enrollment_end_date: Date;

  @Column({ default: false })
  is_institution_wide: boolean;

  // ==================== CORE COURSE FIELDS ====================
  @Column({
    type: "enum",
    enum: CourseLevel,
    default: CourseLevel.BEGINNER,
  })
  level: CourseLevel;

  @Column({
    type: "enum",
    enum: CourseStatus,
    default: CourseStatus.DRAFT,
  })
  status: CourseStatus;

  @Column({ default: 0 })
  enrollment_count: number;

  @Column({ type: "decimal", precision: 5, scale: 2, default: 0 })
  completion_rate: number;

  @Column({ type: "decimal", precision: 3, scale: 2, default: 0 })
  average_rating: number;

  @Column({ default: 0 })
  total_reviews: number;

  @Column({ type: "integer", default: 0 })
  duration_minutes: number;

  @Column({ type: "integer", default: 0 })
  total_lessons: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  price: number;

  @Column({ default: false })
  is_certificate_available: boolean;

  @Column({ type: "text", nullable: true })
  requirements: string;

  @Column({ type: "text", nullable: true })
  what_you_will_learn: string;

  @Column({ nullable: true })
  language: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: "timestamp", nullable: true })
  published_at: Date;

  // ==================== RELATIONS ====================
  @OneToMany(() => Module, (module) => module.course)
  modules: Module[];

  @OneToMany(() => Lesson, (lesson) => lesson.course)
  lessons: Lesson[];

  @OneToMany(() => Progress, (progress) => progress.course)
  progress_records: Progress[];

  @OneToMany(() => Enrollment, (enrollment) => enrollment.course)
  enrollments: Enrollment[];

  @OneToMany(() => Certificate, (certificate) => certificate.course)
  certificates: Certificate[];

  @OneToMany(() => Review, (review) => review.course)
  reviews: Review[];

  @OneToMany(() => CourseInstructor, (instructor) => instructor.course)
  course_instructors: CourseInstructor[];

  @OneToOne(() => Space, (space) => space.course)
  space: Space;
}