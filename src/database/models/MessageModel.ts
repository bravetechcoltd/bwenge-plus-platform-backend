
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn, Index } from "typeorm";
import { User } from "./User";
import { Conversation } from "./ConversationModel";

@Entity()
@Index(["conversation", "createdAt"])
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversationId" })
  conversation!: Conversation;

  @Column({ type: "uuid" })
  conversationId!: string;

  @ManyToOne(() => User, (user) => user.sentMessages, { onDelete: "CASCADE" })
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

  markAsRead(): void {
    this.isRead = true;
    this.status = "read";
    this.readAt = new Date();
  }
}