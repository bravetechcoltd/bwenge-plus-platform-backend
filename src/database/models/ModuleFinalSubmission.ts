
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
import { ModuleFinalAssessment } from "./ModuleFinalAssessment";
import { User } from "./User";

export enum SubmissionStatus {
  PENDING = "PENDING",
  PASSED = "PASSED",
  FAILED = "FAILED",
}

@Entity("module_final_submissions")
export class ModuleFinalSubmission {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  module_final_assessment_id: string;

  @ManyToOne(() => ModuleFinalAssessment, (assessment) => assessment.submissions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "module_final_assessment_id" })
  module_final_assessment: ModuleFinalAssessment;

  @Column({ type: "uuid" })
  @Index()
  user_id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ nullable: true })
  submitted_file_url: string;

  @Column({ type: "jsonb", nullable: true })
  answer_data: any;

  @Column({
    type: "enum",
    enum: SubmissionStatus,
    default: SubmissionStatus.PENDING,
  })
  status: SubmissionStatus;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  score: number;

  @Column({ type: "text", nullable: true })
  instructor_feedback: string;

  @CreateDateColumn()
  submitted_at: Date;

  @UpdateDateColumn()
  graded_at: Date;
}