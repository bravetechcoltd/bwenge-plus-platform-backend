
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Course } from "./Course";
import { Lesson } from "./Lesson";
import { ModuleFinalAssessment } from "./ModuleFinalAssessment";

@Entity("modules")
export class Module {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  course_id: string;

  @ManyToOne(() => Course, (course) => course.modules, { onDelete: "CASCADE" })
  @JoinColumn({ name: "course_id" })
  course: Course;

  @Column()
  title: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "integer", default: 0 })
  order_index: number;

  @Column({ default: false })
  is_published: boolean;

  @Column({ type: "integer", nullable: true })
  estimated_duration_hours: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => Lesson, (lesson) => lesson.module)
  lessons: Lesson[];

  @OneToOne(() => ModuleFinalAssessment, (assessment) => assessment.module)
  final_assessment: ModuleFinalAssessment;
}
