// backend/src/database/models/Role.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { UserRole } from "./UserRole";
import { Institution } from "./Institution";

@Entity("roles")
@Index(["institution_id", "name"], { unique: true })
export class Role {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string; // e.g., "INSTITUTION_ADMIN", "CONTENT_MANAGER"

  @Column()
  display_name: string; // e.g., "Institution Administrator"

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  institution_id: string | null; // null for system-wide roles

  @ManyToOne(() => Institution, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "institution_id" })
  institution: Institution | null;

  @Column({ type: "jsonb", default: [] })
  permissions: string[]; // Array of permission keys

  @Column({ default: false })
  is_system_role: boolean; // System roles cannot be modified/deleted

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: "integer", default: 0 })
  user_count: number; // Denormalized count

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => UserRole, (userRole: UserRole) => userRole.role)
  user_roles: UserRole[];
}