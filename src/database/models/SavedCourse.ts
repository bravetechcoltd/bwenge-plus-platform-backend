import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from "typeorm";
import { User } from "./User";
import { Course } from "./Course";

@Entity("saved_courses")
@Unique(["user_id", "course_id"])
export class SavedCourse {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  user_id: string;

  @ManyToOne(() => User, (user) => user.saved_courses, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ type: "uuid" })
  @Index()
  course_id: string;

  @ManyToOne(() => Course, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({ type: "simple-array", nullable: true })
  tags: string[];

  @CreateDateColumn()
  saved_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}