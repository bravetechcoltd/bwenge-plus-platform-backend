
import { Entity, Unique, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Column } from "typeorm";
import { Space } from "./SpaceModel";
import { User } from "./User";

@Entity()
@Unique(["spaceId", "userId"])
export class SpaceMember {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Space, space => space.members, { onDelete: "CASCADE" })
  @JoinColumn({ name: "spaceId" })
  space!: Space;

  @Column({ type: "uuid" })
  spaceId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ default: false })
  isMuted!: boolean;
}