import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from "typeorm";

/**
 * Stores per-user emoji reactions on private messages.
 * A unique constraint on (messageId, userId, emoji) enforces one reaction
 * per emoji per user per message; toggling is handled in the controller.
 */
@Entity()
@Unique(["messageId", "userId", "emoji"])
@Index(["messageId"])
export class MessageReaction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  messageId!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar", length: 8 })
  emoji!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
