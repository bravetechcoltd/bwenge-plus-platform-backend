import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  ManyToOne, 
  OneToMany, 
  CreateDateColumn, 
  UpdateDateColumn, 
  JoinColumn, 
  Unique,
  Index
} from "typeorm";
import { User } from "./User";
import { Course } from "./Course";
import { Message } from "./MessageModel";
import { Institution } from "./Institution";

export enum ConversationType {
  DIRECT = "DIRECT",
  SUPPORT = "SUPPORT",
  COURSE_QUERY = "COURSE_QUERY",
  INSTITUTION_DIRECT = "INSTITUTION_DIRECT",
}

@Entity()
@Unique("UQ_CONVERSATION_PARTICIPANTS_COURSE", ["participantOneId", "participantTwoId", "courseId"])
export class Conversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // New generic participant fields
  @Column({ type: "uuid" })
  @Index("IDX_CONVERSATION_PARTICIPANT_ONE")
  participantOneId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "participantOneId" })
  participantOne!: User;

  @Column({ type: "uuid" })
  @Index("IDX_CONVERSATION_PARTICIPANT_TWO")
  participantTwoId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "participantTwoId" })
  participantTwo!: User;

  // Old columns - make them nullable for backward compatibility
  @Column({ type: "uuid", nullable: true })
  @Index("IDX_CONVERSATION_STUDENT")
  studentId!: string | null;

  @Column({ type: "uuid", nullable: true })
  @Index("IDX_CONVERSATION_INSTRUCTOR")
  instructorId!: string | null;

  // Course reference (nullable for non-course conversations)
  @ManyToOne(() => Course, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "courseId" })
  course!: Course | null;

  @Column({ type: "uuid", nullable: true })
  @Index("IDX_CONVERSATION_COURSE")
  courseId!: string | null;

  // Institution reference for institution-scoped conversations
  @ManyToOne(() => Institution, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "institutionId" })
  institution!: Institution | null;

  @Column({ type: "uuid", nullable: true })
  @Index("IDX_CONVERSATION_INSTITUTION")
  institutionId!: string | null;

  // Conversation type to describe intent
  @Column({
    type: "enum",
    enum: ConversationType,
    default: ConversationType.DIRECT,
  })
  conversationType!: ConversationType;

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];

  @Column({ default: false })
  isArchived!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Helper method to get the other participant
  getOtherUser(currentUserId: string): User | null {
    if (this.participantOneId === currentUserId) {
      return this.participantTwo;
    } else if (this.participantTwoId === currentUserId) {
      return this.participantOne;
    }
    return null;
  }

  // Helper method to get unread count for a user
  getUnreadCount(currentUserId: string): number {
    if (!this.messages) return 0;
    return this.messages.filter(
      message => message.senderId !== currentUserId && !message.isRead
    ).length;
  }

  // Helper method to get last message
  getLastMessage(): Message | null {
    if (!this.messages || this.messages.length === 0) return null;
    return this.messages.reduce((latest, current) => 
      current.createdAt > latest.createdAt ? current : latest
    );
  }

  // Helper to check if a user is a participant
  isParticipant(userId: string): boolean {
    return this.participantOneId === userId || this.participantTwoId === userId;
  }

  // Helper to get both participant IDs
  getParticipantIds(): [string, string] {
    return [this.participantOneId, this.participantTwoId];
  }
}

// Helper function to ensure consistent participant ordering
export function normalizeParticipants(userIdA: string, userIdB: string): [string, string] {
  return userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
}