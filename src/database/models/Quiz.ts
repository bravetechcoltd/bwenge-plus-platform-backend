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
import { Lesson } from "./Lesson";
import { Course } from "./Course";
import { Answer } from "./Answer";
import { Question } from "./Question";

export enum QuestionType {
  MULTIPLE_CHOICE = "MULTIPLE_CHOICE",
  TRUE_FALSE = "TRUE_FALSE",
  SHORT_ANSWER = "SHORT_ANSWER",
  ESSAY = "ESSAY",
}

// ==================== QUIZ ENTITY ====================
@Entity("quizzes")
export class Quiz {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  course_id: string;

  @ManyToOne(() => Course, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column({ type: "uuid", nullable: true })
  @Index()
  lesson_id: string;

  @ManyToOne(() => Lesson, (lesson) => lesson.quizzes, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "lesson_id" })
  lesson: Lesson;

  @Column()
  title: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "integer", default: 70 })
  passing_score: number;

  @Column({ type: "integer", nullable: true })
  time_limit_minutes: number;

  @Column({ type: "integer", default: 3 })
  max_attempts: number;

  @Column({ default: false })
  shuffle_questions: boolean;

  @Column({ default: false })
  show_correct_answers: boolean;

  @Column({ default: true })
  is_published: boolean;

  @OneToMany(() => Question, (question) => question.quiz)
  questions: Question[];

  @OneToMany(() => Answer, (answer) => answer.quiz)
  answers: Answer[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}