
import { Entity, Index, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { Space } from "./SpaceModel";
import { User } from "./User";

@Entity()
@Index(["spaceId", "createdAt"])
export class SpaceMessage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Space, s => s.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "spaceId" })
  space!: Space;

  @Column({ type: "uuid" })
  spaceId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "senderId" })
  sender!: User;

  @Column({ type: "uuid" })
  senderId!: string;

  @Column("text")
  content!: string;

  @Column({ default: false })
  isRead!: boolean;

  @Column("timestamp", { nullable: true })
  readAt!: Date | null;

  @Column({ nullable: true })
  attachmentUrl!: string;

  @Column({ type: "enum", enum: ["sent", "delivered", "read"], default: "sent" })
  status!: "sent" | "delivered" | "read";

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}