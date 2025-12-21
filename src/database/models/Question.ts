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

import { Answer } from "./Answer";
import { Quiz } from "./Quiz";

export enum QuestionType {
  MULTIPLE_CHOICE = "MULTIPLE_CHOICE",
  TRUE_FALSE = "TRUE_FALSE",
  SHORT_ANSWER = "SHORT_ANSWER",
  ESSAY = "ESSAY",
}


@Entity("questions")
export class Question {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  quiz_id: string;

  @ManyToOne(() => Quiz, (quiz) => quiz.questions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "quiz_id" })
  quiz: Quiz;

  @Column({ type: "text" })
  question_text: string;

  @Column({
    type: "enum",
    enum: QuestionType,
    default: QuestionType.MULTIPLE_CHOICE,
  })
  question_type: QuestionType;

  @Column({ type: "jsonb", nullable: true })
  options: string[];

  @Column({ type: "text" })
  correct_answer: string;

  @Column({ type: "text", nullable: true })
  explanation: string;

  @Column({ type: "integer", default: 1 })
  points: number;

  @Column({ type: "integer", default: 0 })
  order_index: number;

  @Column({ nullable: true })
  image_url: string;

  @OneToMany(() => Answer, (answer: Answer) => answer.quiz)
  answers: Answer[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
