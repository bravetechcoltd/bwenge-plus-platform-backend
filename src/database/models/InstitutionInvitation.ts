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
import { Institution } from "./Institution";
import { User } from "./User";

export enum InvitationStatus {
  PENDING = "pending",
  ACCEPTED = "accepted",
  EXPIRED = "expired",
  CANCELLED = "cancelled",
}

export enum InvitationType {
  EMAIL = "email",
  LINK = "link",
}

@Entity("institution_invitations")
export class InstitutionInvitation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  institution_id: string;

  @ManyToOne(() => Institution, { onDelete: "CASCADE" })
  @JoinColumn({ name: "institution_id" })
  institution: Institution;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  role: string;

  @Column({
    type: "enum",
    enum: InvitationStatus,
    default: InvitationStatus.PENDING,
  })
  status: InvitationStatus;

  @Column({
    type: "enum",
    enum: InvitationType,
    default: InvitationType.EMAIL,
  })
  type: InvitationType;

  @Column({ type: "uuid", nullable: true })
  invited_by: string;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "invited_by" })
  inviter: User;

  @Column({ type: "text", nullable: true })
  message: string;

  /** Unique token used for shareable invite links */
  @Column({ nullable: true, unique: true })
  token: string;

  @Column({ type: "timestamp", nullable: true })
  expires_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
