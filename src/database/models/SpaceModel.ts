import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  JoinColumn, 
  OneToMany, 
  CreateDateColumn, 
  ManyToOne,
  Unique,
  Index
} from "typeorm";
import { Course } from "./Course";
import { SpaceMember } from "./SpaceMemberModel";
import { SpaceMessage } from "./SpaceMessageModel";
import { Institution } from "./Institution";

export enum SpaceType {
  COURSE_SPACE = "COURSE_SPACE",
  INSTITUTION_SPACE = "INSTITUTION_SPACE",
}

@Entity()
@Unique(["institutionId", "spaceType"]) // Only one INSTITUTION_SPACE per institution
export class Space {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Name for institution spaces (can be null for course spaces)
  @Column({ type: "varchar", length: 255, nullable: true })
  name!: string | null;

  // Space type to distinguish between course and institution spaces
  @Column({
    type: "enum",
    enum: SpaceType,
    default: SpaceType.COURSE_SPACE,
  })
  spaceType!: SpaceType;

  // Course relation - now ManyToOne and nullable
  @ManyToOne(() => Course, course => course.spaces, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "courseId" })
  course!: Course | null;

  @Column({ type: "uuid", nullable: true })
  @Index({ unique: false }) // Use non-unique index
  courseId!: string | null;

  // Institution relation for institution-wide spaces
  @ManyToOne(() => Institution, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "institutionId" })
  institution!: Institution | null;

  @Column({ type: "uuid", nullable: true })
  @Index({ unique: false }) // Use non-unique index
  institutionId!: string | null;

  @OneToMany(() => SpaceMember, m => m.space)
  members!: SpaceMember[];

  @OneToMany(() => SpaceMessage, m => m.space)
  messages!: SpaceMessage[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}