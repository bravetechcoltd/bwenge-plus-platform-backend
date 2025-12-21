import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";
import { Course } from "./Course";
import { Module } from "./Module";
import { Lesson } from "./Lesson";

export enum EventType {
  LESSON = "LESSON",
  ASSESSMENT = "ASSESSMENT",
  MEETING = "MEETING",
  OFFICE_HOURS = "OFFICE_HOURS",
  WEBINAR = "WEBINAR",
  DEADLINE = "DEADLINE",
  OTHER = "OTHER",
}

export enum EventStatus {
  SCHEDULED = "SCHEDULED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export enum RecurrencePattern {
  DAILY = "DAILY",
  WEEKLY = "WEEKLY",
  BIWEEKLY = "BIWEEKLY",
  MONTHLY = "MONTHLY",
  CUSTOM = "CUSTOM",
}

@Entity("eventschedule")
@Index(["course_id", "start_date"])
@Index(["created_by", "start_date"])
export class EventSchedule {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  title: string;

  @Column({
    type: "enum",
    enum: EventType,
    default: EventType.OTHER,
  })
  type: EventType;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "uuid" })
  @Index()
  course_id: string;

  @ManyToOne(() => Course, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column({ type: "uuid", nullable: true })
  @Index()
  module_id: string;

  @ManyToOne(() => Module, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "module_id" })
  module: Module;

  @Column({ type: "uuid", nullable: true })
  @Index()
  lesson_id: string;

  @ManyToOne(() => Lesson, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "lesson_id" })
  lesson: Lesson;

  @Column({ type: "timestamp" })
  start_date: Date;

  @Column({ type: "timestamp" })
  end_date: Date;

  @Column({ type: "varchar", length: 255, nullable: true })
  location: string;

  @Column({ type: "text", nullable: true })
  meeting_url: string;

  @Column({ type: "boolean", default: false })
  is_recurring: boolean;

  @Column({
    type: "enum",
    enum: RecurrencePattern,
    nullable: true,
  })
  recurrence_pattern: RecurrencePattern;

  @Column({ type: "jsonb", nullable: true })
  recurrence_config: any;

  @Column({
    type: "enum",
    enum: EventStatus,
    default: EventStatus.SCHEDULED,
  })
  status: EventStatus;

  @Column({ type: "uuid" })
  @Index()
  created_by: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "created_by" })
  creator: User;

  @Column({ type: "uuid", nullable: true })
  updated_by: string;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "updated_by" })
  updater: User;

  @Column({ type: "boolean", default: true })
  is_active: boolean;

  @Column({ type: "jsonb", nullable: true })
  metadata: any;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
