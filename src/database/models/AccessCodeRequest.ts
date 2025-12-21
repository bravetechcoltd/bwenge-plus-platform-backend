
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

export enum AccessCodeRequestStatus {
  PENDING = "PENDING",
  CODE_SENT = "CODE_SENT",
  ENROLLED = "ENROLLED",
  EXPIRED = "EXPIRED",
}

@Entity("access_code_requests")
export class AccessCodeRequest {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("uuid")
  @Index()
  user_id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column("uuid")
  @Index()
  course_id: string;

  @ManyToOne(() => Course, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column({ type: "uuid", nullable: true })
  institution_id: string;

  @Column({ type: "text", nullable: true })
  message: string;

  @Column({
    type: "enum",
    enum: AccessCodeRequestStatus,
    default: AccessCodeRequestStatus.PENDING,
  })
  status: AccessCodeRequestStatus;

  @Column({ nullable: true })
  generated_code: string;

  @Column({ type: "timestamp", nullable: true })
  code_sent_at: Date;

  @Column({ type: "uuid", nullable: true })
  processed_by_admin_id: string;

  @Column({ type: "timestamp", nullable: true })
  processed_at: Date;

  @CreateDateColumn()
  requested_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}