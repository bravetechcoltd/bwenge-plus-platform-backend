import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";

export enum SystemType {
  ONGERA = "ongera",      
  BWENGE_PLUS = "bwengeplus"  
}

@Entity("user_sessions")
export class UserSession {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  user_id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({
    type: "enum",
    enum: SystemType,
  })
  @Index()
  system: SystemType;

  @Column({ unique: true })
  @Index()
  session_token: string;

  @Column({ type: "text", nullable: true })
  device_info: string;

  @Column({ nullable: true })
  ip_address: string;

  @Column({ type: "timestamp" })
  expires_at: Date;

  @Column({ default: true })
  @Index()
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  last_activity: Date;
}