
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, CreateDateColumn, UpdateDateColumn, JoinColumn, Unique } from "typeorm";
import { User } from "./User";
import { Course } from "./Course";
import { Message } from "./MessageModel";

@Entity()
@Unique(["student", "instructor", "course"]) 
export class Conversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.studentConversations, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: User;

  @Column({ type: "uuid" })
  studentId!: string;

  @ManyToOne(() => User, (user) => user.instructorConversations, { onDelete: "CASCADE" })
  @JoinColumn({ name: "instructorId" })
  instructor!: User;

  @Column({ type: "uuid" })
  instructorId!: string;

  @ManyToOne(() => Course, { onDelete: "CASCADE" })
  @JoinColumn({ name: "courseId" })
  course!: Course;

  @Column({ type: "uuid" })
  courseId!: string;

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];

  @Column({ default: false })
  isArchived!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  getOtherUser(currentUserId: string): User {
    return this.studentId === currentUserId ? this.instructor : this.student;
  }

  getUnreadCount(currentUserId: string): number {
    if (!this.messages) return 0;
    return this.messages.filter(
      message => message.senderId !== currentUserId && !message.isRead
    ).length;
  }

  getLastMessage(): Message | null {
    if (!this.messages || this.messages.length === 0) return null;
    return this.messages.reduce((latest, current) => 
      current.createdAt > latest.createdAt ? current : latest
    );
  }
}