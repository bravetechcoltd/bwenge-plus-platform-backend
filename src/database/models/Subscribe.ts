import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("subscribers")
export class Subscribe {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ default: true })
  notify_new_communities: boolean;

  @Column({ default: true })
  notify_new_projects: boolean;

  @Column({ default: true })
  notify_new_events: boolean;

  @CreateDateColumn()
  subscribed_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: "timestamp", nullable: true })
  last_notification_sent: Date;
}