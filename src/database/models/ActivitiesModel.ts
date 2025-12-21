
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class ActivityLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  user!: User | null;

  @Column({ type: "uuid", nullable: true })
  userId!: string | null;

  @Column()
  action!: string;

  @Column({ nullable: true })
  targetId!: string;

  @Column({ nullable: true })
  targetType!: string;

  @Column({ type: "text", nullable: true })
  details!: string;

  @CreateDateColumn()
  createdAt!: Date;
}