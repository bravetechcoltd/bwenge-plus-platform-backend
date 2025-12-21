import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from "typeorm";
import { User } from "./User";

export enum AcademicLevel {
  UNDERGRADUATE = "Undergraduate",
  MASTERS = "Masters",
  PHD = "PhD",
  PROFESSIONAL = "Professional",
}

@Entity("user_profiles")
export class UserProfile {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @OneToOne(() => User, (user) => user.profile)
  @JoinColumn({ name: "user_id" })
  user: User;

  // ===== STUDENT/RESEARCHER/DIASPORA FIELDS =====
  @Column({ nullable: true })
  institution_name: string;

  @Column({ nullable: true })
  department: string;

  @Column({
    type: "enum",
    enum: AcademicLevel,
    nullable: true,
  })
  academic_level: AcademicLevel;

  @Column({ type: "jsonb", nullable: true })
  research_interests: string[];

  @Column({ nullable: true })
  orcid_id: string;

  @Column({ nullable: true })
  google_scholar_url: string;

  @Column({ nullable: true })
  linkedin_url: string;

  @Column({ nullable: true })
  website_url: string;

  @Column({ nullable: true })
  cv_file_url: string;

  @Column({ nullable: true })
  current_position: string;

  @Column({ nullable: true })
  home_institution: string;

  @Column({ default: false })
  willing_to_mentor: boolean;

  @Column({ default: 0 })
  total_projects_count: number;

  @Column({ default: 0 })
  total_followers_count: number;

  @Column({ default: 0 })
  total_following_count: number;

  // ===== NEW: INSTITUTION-SPECIFIC FIELDS =====
  @Column({ nullable: true })
  institution_address: string;

  @Column({ nullable: true })
  institution_phone: string;

  @Column({ nullable: true })
  institution_type: string; // University, Research Center, etc.

  @Column({ nullable: true })
  institution_website: string;

  @Column({ type: "text", nullable: true })
  institution_description: string;

  @Column({ type: "jsonb", nullable: true })
  institution_departments: string[];

  @Column({ type: "integer", nullable: true })
  institution_founded_year: number;

  @Column({ nullable: true })
  institution_accreditation: string;
}