
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { Module } from "./Module";
import { Assessment } from "./Assessment";
import { ModuleFinalSubmission } from "./ModuleFinalSubmission";

export enum ModuleFinalType {
  ASSESSMENT = "ASSESSMENT",
  PROJECT = "PROJECT",
}

@Entity("module_final_assessments")
export class ModuleFinalAssessment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", unique: true })
  module_id: string;

  @OneToOne(() => Module, (module) => module.final_assessment, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "module_id" })
  module: Module;

  @Column()
  title: string;

  @Column({
    type: "enum",
    enum: ModuleFinalType,
  })
  type: ModuleFinalType;

  @Column({ type: "uuid", nullable: true })
  assessment_id: string;

  @ManyToOne(() => Assessment, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assessment_id" })
  assessment: Assessment;

  @Column({ type: "text", nullable: true })
  project_instructions: string;

  @Column({ type: "integer", default: 70 })
  passing_score_percentage: number;

  @Column({ type: "integer", nullable: true })
  time_limit_minutes: number;

  @Column({ default: false })
  requires_file_submission: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => ModuleFinalSubmission, (submission) => submission.module_final_assessment)
  submissions: ModuleFinalSubmission[];
}