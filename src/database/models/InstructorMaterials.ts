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
import { Module } from "./Module";
import { Lesson } from "./Lesson";

export enum MaterialType {
  PDF = "PDF",
  VIDEO = "VIDEO",
  AUDIO = "AUDIO",
  DOCUMENT = "DOCUMENT",
  PRESENTATION = "PRESENTATION",
  SPREADSHEET = "SPREADSHEET",
  IMAGE = "IMAGE",
  ARCHIVE = "ARCHIVE",
  OTHER = "OTHER",
}

export enum MaterialStatus {
  ACTIVE = "ACTIVE",
  ARCHIVED = "ARCHIVED",
  DELETED = "DELETED",
}

@Entity("instructormaterials")
@Index(["course_id", "uploaded_by"])
@Index(["course_id", "material_type"])
export class InstructorMaterials {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  title: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "uuid" })
  @Index()
  course_id: string;

  @ManyToOne(() => Course, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column({ type: "uuid", nullable: true })
  @Index()
  module_id: string;

  @ManyToOne(() => Module, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "module_id" })
  module: Module;

  @Column({ type: "uuid", nullable: true })
  @Index()
  lesson_id: string;

  @ManyToOne(() => Lesson, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "lesson_id" })
  lesson: Lesson;

  @Column({ type: "text" })
  file_url: string;

  @Column({ type: "varchar", length: 255 })
  file_name: string;

  @Column({
    type: "enum",
    enum: MaterialType,
    default: MaterialType.OTHER,
  })
  material_type: MaterialType;

  @Column({ type: "varchar", length: 50, nullable: true })
  file_extension: string;

  @Column({ type: "bigint", nullable: true })
  file_size: number;

  @Column({ type: "varchar", length: 255, nullable: true })
  cloudinary_public_id: string;

  @Column({ type: "boolean", default: true })
  is_downloadable: boolean;

  @Column({ type: "boolean", default: false })
  is_required: boolean;

  @Column({ type: "integer", default: 0 })
  download_count: number;

  @Column({ type: "integer", default: 0 })
  view_count: number;

  @Column({
    type: "enum",
    enum: MaterialStatus,
    default: MaterialStatus.ACTIVE,
  })
  status: MaterialStatus;

  @Column({ type: "uuid" })
  @Index()
  uploaded_by: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "uploaded_by" })
  uploader: User;

  @Column({ type: "jsonb", nullable: true })
  metadata: any;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
