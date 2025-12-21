import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";


export enum ActivityAction {
  // Auth
  LOGIN                              = "LOGIN",
  LOGOUT                             = "LOGOUT",
  FAILED_LOGIN                       = "FAILED_LOGIN",
  PASSWORD_RESET_REQUEST             = "PASSWORD_RESET_REQUEST",
  PASSWORD_RESET_COMPLETE            = "PASSWORD_RESET_COMPLETE",
  TWO_FACTOR_ENABLED                 = "TWO_FACTOR_ENABLED",
  TWO_FACTOR_DISABLED                = "TWO_FACTOR_DISABLED",

  // User management
  CREATE_USER                        = "CREATE_USER",
  UPDATE_USER                        = "UPDATE_USER",
  DELETE_USER                        = "DELETE_USER",
  DEACTIVATE_USER                    = "DEACTIVATE_USER",
  REACTIVATE_USER                    = "REACTIVATE_USER",
  UPDATE_USER_ROLE                   = "UPDATE_USER_ROLE",

  // Institution management
  CREATE_INSTITUTION                 = "CREATE_INSTITUTION",
  UPDATE_INSTITUTION                 = "UPDATE_INSTITUTION",
  DELETE_INSTITUTION                 = "DELETE_INSTITUTION",
  UPDATE_INSTITUTION_SECURITY_SETTINGS = "UPDATE_INSTITUTION_SECURITY_SETTINGS",

  // Member management
  ADD_INSTITUTION_MEMBER             = "ADD_INSTITUTION_MEMBER",
  REMOVE_INSTITUTION_MEMBER          = "REMOVE_INSTITUTION_MEMBER",
  UPDATE_MEMBER_ROLE                 = "UPDATE_MEMBER_ROLE",

  // Course management
  CREATE_COURSE                      = "CREATE_COURSE",
  UPDATE_COURSE                      = "UPDATE_COURSE",
  DELETE_COURSE                      = "DELETE_COURSE",
  PUBLISH_COURSE                     = "PUBLISH_COURSE",
  UNPUBLISH_COURSE                   = "UNPUBLISH_COURSE",

  // Enrollment
  CREATE_ENROLLMENT                  = "CREATE_ENROLLMENT",
  UPDATE_ENROLLMENT                  = "UPDATE_ENROLLMENT",
  DELETE_ENROLLMENT                  = "DELETE_ENROLLMENT",
  COMPLETE_ENROLLMENT                = "COMPLETE_ENROLLMENT",

  TERMINATE_USER_SESSION             = "TERMINATE_USER_SESSION",
  TERMINATE_ALL_USER_SESSIONS        = "TERMINATE_ALL_USER_SESSIONS",
  CLEANUP_EXPIRED_SESSIONS           = "CLEANUP_EXPIRED_SESSIONS",

  SYSTEM_ERROR                       = "SYSTEM_ERROR",
  EXPORT_DATA                        = "EXPORT_DATA",
}


@Entity("activity_logs")
@Index(["action"])
@Index(["targetType", "targetId"])
@Index(["createdAt"])
export class ActivityLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;


  @Column({ type: "uuid", nullable: true, name: "user_id" })
  @Index()
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL", eager: false })
  @JoinColumn({ name: "user_id" })
  user: User | null;


  @Column({
     type: "varchar", length: 128,
     nullable:true
     })
  action: string;


  @Column({ type: "varchar", length: 64, nullable: true, name: "target_type" })
  targetType: string | null;


  @Column({ type: "text", nullable: true, name: "target_id" })
  targetId: string | null;

  @Column({ type: "text", nullable: true })
  details: string | null;


  @Column({ type: "varchar", length: 45, nullable: true, name: "ip_address" })
  ipAddress: string | null;

 
  @Column({ type: "text", nullable: true, name: "user_agent" })
  userAgent: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}