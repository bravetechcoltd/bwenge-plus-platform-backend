
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
import { User } from "./User";
import { Institution } from "./Institution";

export enum InstitutionMemberRole {
  ADMIN = "ADMIN",
  CONTENT_CREATOR = "CONTENT_CREATOR",
  INSTRUCTOR = "INSTRUCTOR",
  MEMBER = "MEMBER",
}

@Entity("institution_members")
@Unique(["user_id", "institution_id"])
export class InstitutionMember {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  user_id: string;

  @ManyToOne(() => User, (user) => user.institution_memberships, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ type: "uuid" })
  @Index()
  institution_id: string;

  @ManyToOne(() => Institution, (institution) => institution.members, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "institution_id" })
  institution: Institution;

  @Column({
    type: "enum",
    enum: InstitutionMemberRole,
    default: InstitutionMemberRole.MEMBER,
  })
  role: InstitutionMemberRole;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  joined_at: Date;

  @Column({ type: "jsonb", nullable: true })
  additional_permissions: {
    can_create_courses?: boolean;
    can_manage_members?: boolean;
    can_view_analytics?: boolean;
    custom_permissions?: string[];
  };
}

