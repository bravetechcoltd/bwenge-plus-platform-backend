// In LessonProgress.ts - Add missing relationship
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from "typeorm";
import { Enrollment } from "./Enrollment";
import { Lesson } from "./Lesson";
import { User } from "./User"; // Add this import

@Entity("lesson_progress")
@Unique(["enrollment_id", "lesson_id"])
export class LessonProgress {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  enrollment_id: string;

  @ManyToOne(() => Enrollment, (enrollment) => enrollment.lesson_progress)
  @JoinColumn({ name: "enrollment_id" })
  enrollment: Enrollment;

  @Column({ type: "uuid" })
  @Index()
  lesson_id: string;

  @ManyToOne(() => Lesson, (lesson) => lesson.progress_records)
  @JoinColumn({ name: "lesson_id" })
  lesson: Lesson;

  // Add this column for the direct relationship with User
  @Column({ type: "uuid" })
  @Index()
  user_id: string;

  // Add this relationship
  @ManyToOne(() => User, (user) => user.lesson_progress)
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ default: false })
  is_completed: boolean;

  @Column({ type: "float", default: 0 })
  completion_percentage: number; // 0-100

  @Column({ type: "integer", default: 0 })
  time_spent_seconds: number;

  @Column({ type: "integer", nullable: true })
  last_position_seconds: number; // For video tracking

  @Column({ type: "float", nullable: true })
  quiz_score: number;

  @Column({ type: "integer", default: 0 })
  attempt_count: number;

  @CreateDateColumn()
  started_at: Date;

  @Column({ type: "timestamp", nullable: true })
  completed_at: Date;

  @UpdateDateColumn()
  last_accessed_at: Date;

  @Column({ type: "jsonb", nullable: true })
  quiz_answers: any;

  @Column({ type: "jsonb", nullable: true })
  notes: string;
}