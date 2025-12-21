import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from "typeorm";
import { Course } from "./Course";
import { CourseCategory } from "./CourseCategory";
import { InstitutionMember } from "./InstitutionMember";

export enum InstitutionType {
  UNIVERSITY = "UNIVERSITY",
  GOVERNMENT = "GOVERNMENT",
  PRIVATE_COMPANY = "PRIVATE_COMPANY",
  NGO = "NGO",
}

@Entity("institutions")
export class Institution {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  @Index()
  name: string;

  @Column({ unique: true })
  @Index()
  slug: string;

  @Column({
    type: "enum",
    enum: InstitutionType,
  })
  type: InstitutionType;

  @Column({ nullable: true })
  logo_url: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ default: true })
  is_active: boolean;

  // NEW: Dynamic limit fields for instructors and members
  @Column({ type: "int", default: 50 })
  max_instructors: number;

  @Column({ type: "int", default: 500 })
  max_members: number;

  @Column({ type: "jsonb", nullable: true })
  settings: {
    security?: {
      require_2fa?: boolean;
      session_timeout?: number;
      max_login_attempts?: number;
      password_complexity?: string;
    };
    courses?: {
      allow_public_courses?: boolean;
      require_approval_for_spoc?: boolean;
    };
    members?: {
      allow_self_registration?: boolean;
      require_approval_for_members?: boolean;
    };
    notifications?: {
      email_notifications?: boolean;
      push_notifications?: boolean;
    };
    custom_branding?: any;
  };

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Virtual properties for query builder counts
  memberCount?: number;
  courseCount?: number;
  categoryCount?: number;
  instructorCount?: number;

  // Relations
  @OneToMany(() => InstitutionMember, (member) => member.institution)
  members: InstitutionMember[];

  @OneToMany(() => Course, (course) => course.institution)
  courses: Course[];

  @OneToMany(() => CourseCategory, (category) => category.institution)
  categories: CourseCategory[];
}