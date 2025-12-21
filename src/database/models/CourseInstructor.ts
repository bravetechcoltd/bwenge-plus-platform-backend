

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from "typeorm";
import { Course } from "./Course";
import { User } from "./User";

@Entity("course_instructors")
@Unique(["course_id", "instructor_id"])
export class CourseInstructor {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  course_id: string;

  @ManyToOne(() => Course, (course) => course.course_instructors, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column({ type: "uuid" })
  @Index()
  instructor_id: string;

  @ManyToOne(() => User, (user) => user.course_instructor_assignments, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "instructor_id" })
  instructor: User;

  @Column({ default: false })
  is_primary_instructor: boolean;

  @Column({ default: true })
  can_grade_assignments: boolean;

  @Column({ default: false })
  can_manage_enrollments: boolean;

  @Column({ default: false })
  can_edit_course_content: boolean;

  @CreateDateColumn()
  assigned_at: Date;
}