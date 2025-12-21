import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("otps")
export class Otp {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  user_id: string;

  @Column()
  otp_code: string;

  @Column({ type: "timestamp" })
  expires_at: Date;

  @Column({ default: false })
  used: boolean;

  @Column({ type: "varchar", length: 50 })
  purpose: string; 

  @CreateDateColumn()
  created_at: Date;
}