import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Institution } from "./Institution";
import { User } from "./User";

export enum BulkImportJobStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

@Entity("bulk_import_jobs")
export class BulkImportJob {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  institution_id: string;

  @ManyToOne(() => Institution, { onDelete: "CASCADE" })
  @JoinColumn({ name: "institution_id" })
  institution: Institution;

  @Column({
    type: "enum",
    enum: BulkImportJobStatus,
    default: BulkImportJobStatus.PENDING,
  })
  status: BulkImportJobStatus;

  @Column({ type: "int", default: 0 })
  total: number;

  @Column({ type: "int", default: 0 })
  processed: number;

  @Column({ type: "int", default: 0 })
  succeeded: number;

  @Column({ type: "int", default: 0 })
  failed: number;

  @Column({ type: "jsonb", nullable: true })
  errors: string[];

  @Column({ type: "uuid", nullable: true })
  created_by: string;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  creator: User;

  @Column({ type: "timestamp", nullable: true })
  completed_at: Date;

  @CreateDateColumn()
  created_at: Date;
}
