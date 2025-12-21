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
      max_instructors?: number;
    };
    members?: {
      allow_self_registration?: boolean;
      require_approval_for_members?: boolean;
      max_members?: number;
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

  // Relations
  @OneToMany(() => InstitutionMember, (member) => member.institution)
  members: InstitutionMember[];

  @OneToMany(() => Course, (course) => course.institution)
  courses: Course[];

  @OneToMany(() => CourseCategory, (category) => category.institution)
  categories: CourseCategory[];
}