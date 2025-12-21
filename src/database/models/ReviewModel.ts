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

@Entity("course_reviews")
@Index(["user_id", "course_id"], { unique: true })
export class Review {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("uuid")
  @Index()
  user_id: string;

  @ManyToOne(() => User, (user) => user.reviews, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column("uuid")
  @Index()
  course_id: string;

  @ManyToOne(() => Course, (course) => course.reviews, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column({ type: "integer" })
  rating: number; // 1-5

  @Column("text", { nullable: true })
  comment: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}