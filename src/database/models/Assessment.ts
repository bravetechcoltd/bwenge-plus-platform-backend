import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { Course } from "./Course";
import { Lesson } from "./Lesson";
import { Module } from "./Module";
import { AssessmentAttempt } from "./AssessmentAttempt";
import { Answer } from "./Answer";
import { Progress } from "./Progress";

export enum AssessmentType {
  QUIZ = "QUIZ",
  EXAM = "EXAM",
  ASSIGNMENT = "ASSIGNMENT",
  PROJECT = "PROJECT",
}

@Entity("assessments")
export class Assessment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("uuid")
  course_id: string;

  @ManyToOne(() => Course, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column("uuid", { nullable: true })
  lesson_id: string;

  @ManyToOne(() => Lesson, (lesson) => lesson.assessments, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "lesson_id" })
  lesson: Lesson;

  // ==================== ENHANCEMENTS ====================
  @Column({ type: "uuid", nullable: true })
  module_id: string;

  @ManyToOne(() => Module, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "module_id" })
  module: Module;

  @Column({ default: false })
  is_final_assessment: boolean;

  @Column({ default: false })
  is_module_final: boolean;

  // Existing fields preserved
  @Column()
  title: string;

  @Column("text", { nullable: true })
  description: string;

  @Column({
    type: "enum",
    enum: AssessmentType,
    default: AssessmentType.QUIZ,
  })
  type: AssessmentType;

  @Column({ type: "jsonb" })
  questions: {
    id: string;
    question: string;
    type: string;
    options?: string[];
    correct_answer?: string | string[];
    points: number;
  }[];

  @Column({ type: "integer", default: 70 })
  passing_score: number;

  @Column({ type: "integer", default: 3 })
  max_attempts: number;

  @Column({ type: "integer", nullable: true })
  time_limit_minutes: number;

  @Column({ default: true })
  is_published: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => AssessmentAttempt, (attempt) => attempt.assessment)
  attempts: AssessmentAttempt[];

  // In the Assessment class:
  @OneToMany(() => Progress, (progress) => progress.assessment)
  progress_records: Progress[];
  // ==================== NEW: ANSWER SUBMISSIONS RELATIONSHIP ====================
  @OneToMany(() => Answer, (answer) => answer.assessment)
  answer_submissions: Answer[];
}