import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("sso_tokens")
export class SSOToken {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  user_id: string;

  @Column({ unique: true })
  @Index()
  token: string;

  @Column({ type: "varchar", length: 50 })
  target_system: string;

  @Column({ type: "timestamp" })
  @Index()
  expires_at: Date;

  @Column({ default: false })
  consumed: boolean;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: "timestamp", nullable: true })
  consumed_at: Date;
}