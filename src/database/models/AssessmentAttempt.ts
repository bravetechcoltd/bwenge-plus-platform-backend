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
import { Assessment } from "./Assessment";
import { User } from "./User";

@Entity("assessment_attempts")
@Index(["user_id", "assessment_id"])
export class AssessmentAttempt {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // ==================== FIXED: Make user_id NULLABLE ====================
  @Column({ type: "uuid", nullable: true })
  @Index()
  user_id: string | null;

  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "user_id" })
  user: User | null;

  @Column({ type: "uuid" })
  @Index()
  @Column({ type: "uuid" })
  assessment_id: string;

  @ManyToOne(() => Assessment, { onDelete: "CASCADE" })
  assessment: Assessment;

  @Column({ type: "integer", default: 1 })
  attempt_number: number;

  @Column({ type: "jsonb", nullable: true })
  answers: any;

  @Column({ type: "float", nullable: true })
  score: number;

  @Column({ type: "float", nullable: true })
  percentage: number;

  @Column({ default: false })
  passed: boolean;

  @Column({ type: "timestamp" })
  started_at: Date;

  @Column({ type: "timestamp", nullable: true })
  submitted_at: Date;

  @Column({ type: "integer", default: 0 })
  time_taken_seconds: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}