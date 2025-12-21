

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
import { Course } from "./Course";
import { Module } from "./Module";
import { Assessment } from "./Assessment";
import { Quiz } from "./Quiz";
import { Progress } from "./Progress";


export enum LessonType {
  VIDEO = "VIDEO",
  TEXT = "TEXT",
  QUIZ = "QUIZ",
  ASSIGNMENT = "ASSIGNMENT",
  LIVE_SESSION = "LIVE_SESSION",
  RESOURCE = "RESOURCE",
}

@Entity("lessons")
export class Lesson {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("uuid")
  @Index()
  course_id: string;

  @ManyToOne(() => Course, (course) => course.lessons, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  // ==================== ENHANCEMENT ====================
  @Column({ type: "uuid", nullable: true })
  @Index()
  module_id: string;

  @ManyToOne(() => Module, (module) => module.lessons, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "module_id" })
  module: Module;

  @Column({ default: false })
  is_preview: boolean;

  // Existing fields preserved
  @Column()
  title: string;

  @Column("text", { nullable: true })
  content: string;

  @Column({ nullable: true })
  video_url: string;

  @Column({ nullable: true })
  thumbnail_url: string;

  @Column({ type: "integer", default: 0 })
  duration_minutes: number;

  @Column({ type: "integer" })
  order_index: number;

  @Column({
    type: "enum",
    enum: LessonType,
    default: LessonType.VIDEO,
  })
  type: LessonType;

  @Column({ default: true })
  is_published: boolean;

  @Column({ type: "jsonb", nullable: true })
  resources: {
    title: string;
    url: string;
    type: string;
  }[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => Assessment, (assessment) => assessment.lesson)
  assessments: Assessment[];

  @OneToMany(() => Quiz, (quiz) => quiz.lesson)
quizzes: Quiz[];

@OneToMany(() => Progress, (progress) => progress.lesson)
progress_records: Progress[];
}
