import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn
} from "typeorm";
import { User } from "./User";
import { Course } from "./Course";

@Entity("certificates")
export class Certificate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("uuid")
  user_id: string;

  @ManyToOne(() => User, (user) => user.certificates, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column("uuid")
  course_id: string;

  @ManyToOne(() => Course, (course) => course.certificates, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column("uuid")
  enrollment_id: string;

  @Column({ unique: true })
  certificate_number: string;

  @Column({ unique: true })
  verification_code: string;

  @CreateDateColumn()
  issue_date: Date;

  @Column({ nullable: true })
  certificate_url: string;

  @Column({ type: "decimal", precision: 5, scale: 2 })
  final_score: number;

  @Column({ default: true })
  is_valid: boolean;

  @Column({ type: "timestamp", nullable: true })
  expires_at: Date;
}
