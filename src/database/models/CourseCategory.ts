import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { Institution } from "./Institution";
import { Course } from "./Course";

@Entity("course_categories")
@Index(["institution_id", "is_active"]) 
@Index(["order_index"])
@Index(["parent_category_id"])

export class CourseCategory {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  institution_id: string;

  @ManyToOne(() => Institution, (institution) => institution.categories, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "institution_id" })
  institution: Institution;

  @Column()
  name: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "uuid", nullable: true })
  parent_category_id: string;

  @ManyToOne(() => CourseCategory, (category) => category.subcategories, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "parent_category_id" })
  parent_category: CourseCategory;

  @OneToMany(() => CourseCategory, (category) => category.parent_category)
  subcategories: CourseCategory[];

  @Column({ type: "integer", default: 0 })
  order_index: number;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => Course, (course) => course.category)
  courses: Course[];
}
