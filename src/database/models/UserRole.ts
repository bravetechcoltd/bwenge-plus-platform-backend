
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
import { Role } from "./Role";
import { Institution } from "./Institution";

@Entity("user_roles")
@Unique(["user_id", "role_id", "institution_id"])
export class UserRole {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  user_id: string;

  @ManyToOne(() => User, (user) => user.user_roles, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ type: "uuid" })
  @Index()
  role_id: string;

  @ManyToOne(() => Role, (role) => role.user_roles, { onDelete: "CASCADE" })
  @JoinColumn({ name: "role_id" })
  role: Role;

  @Column({ type: "uuid", nullable: true })
  @Index()
  institution_id: string | null;

  @ManyToOne(() => Institution, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "institution_id" })
  institution: Institution | null;

  @Column({ type: "jsonb", nullable: true })
  granted_by: {
    user_id: string;
    user_email: string;
  };

  @Column({ type: "timestamp", nullable: true })
  expires_at: Date | null;

  @CreateDateColumn()
  granted_at: Date;
}