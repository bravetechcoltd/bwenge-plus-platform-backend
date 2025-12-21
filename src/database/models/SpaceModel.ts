
import { Entity, PrimaryGeneratedColumn, Column, JoinColumn, OneToMany, CreateDateColumn, OneToOne } from "typeorm";
import { Course } from "./Course";
import { SpaceMember } from "./SpaceMemberModel";
import { SpaceMessage } from "./SpaceMessageModel";

@Entity()
export class Space {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @OneToOne(() => Course, course => course.space, { onDelete: "CASCADE" })
  @JoinColumn({ name: "courseId" })
  course!: Course;

  @Column({ type: "uuid" })
  courseId!: string;

  @OneToMany(() => SpaceMember, m => m.space)
  members!: SpaceMember[];

  @OneToMany(() => SpaceMessage, m => m.space)
  messages!: SpaceMessage[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}