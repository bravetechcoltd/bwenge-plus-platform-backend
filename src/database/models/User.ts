// @ts-nocheck
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  BeforeUpdate,
  AfterLoad,
} from "typeorm";
import { UserProfile } from "./UserProfile";
import { SavedCourse } from "./SavedCourse";
import { UserRole } from "./UserRole";
import { UserSession, SystemType } from "./UserSession";
import { Course } from "./Course";
import { Enrollment } from "./Enrollment";
import { Certificate } from "./Certificate";
import { LessonProgress } from "./LessonProgress";
import { InstitutionMember } from "./InstitutionMember";
import { CourseInstructor } from "./CourseInstructor";
import { Answer } from "./Answer";
import { Review } from "./ReviewModel";
import { Progress } from "./Progress";
import { Message } from "./MessageModel";
import { Conversation } from "./ConversationModel";

export enum AccountType {
  STUDENT = "Student",
  RESEARCHER = "Researcher",
  DIASPORA = "Diaspora",
  INSTITUTION = "Institution",
  ADMIN = "admin",
}

export enum BwengeRole {
  SYSTEM_ADMIN = "SYSTEM_ADMIN",
  INSTITUTION_ADMIN = "INSTITUTION_ADMIN",
  CONTENT_CREATOR = "CONTENT_CREATOR",
  INSTRUCTOR = "INSTRUCTOR",
  LEARNER = "LEARNER",
}

export enum InstitutionRole {
  ADMIN = "ADMIN",
  CONTENT_CREATOR = "CONTENT_CREATOR",
  INSTRUCTOR = "INSTRUCTOR",
  MEMBER = "MEMBER",
}

export enum ApplicationStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

// ✅ Re-export SystemType from this file so any code that previously imported
// it from User.ts continues to work without changes.
export { SystemType };

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password_hash: string;

  @Column({ unique: true, nullable: true })
  username: string;

  @Column({ nullable: true })
  first_name: string;

  @Column({ nullable: true })
  last_name: string;

  @Column({ nullable: true })
  phone_number: string;

  @Column({ nullable: true })
  profile_picture_url: string;

  @Column({ type: "text", nullable: true })
  bio: string;

  @Column({
    type: "enum",
    enum: AccountType,
    nullable: true,
  })
  account_type: AccountType;

  @Column({ default: false })
  is_verified: boolean;

  @Column({ default: true })
  is_active: boolean;

  @Column({
    type: "enum",
    enum: ApplicationStatus,
    nullable: true,
  })
  application_status: ApplicationStatus;

  @Column({ type: "timestamp", nullable: true })
  applied_at: Date;

  @Column({ type: "text", nullable: true })
  rejection_reason: string;

  @Column({ default: false })
  isUserLogin: boolean;

  @CreateDateColumn()
  date_joined: Date;

  @Column({ type: "timestamp", nullable: true })
  last_login: Date;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  social_auth_provider: string;

  @Column({ nullable: true })
  social_auth_id: string;

  @Column({
    type: "enum",
    enum: SystemType,
    nullable: true,
  })
  IsForWhichSystem: SystemType;

  @OneToMany(() => Review, (review) => review.user)
  reviews: Review[];

  @OneToMany(() => Progress, (progress) => progress.user)
  progress_records: Progress[];

  @Column({ type: "uuid", nullable: true })
  primary_institution_id: string;

  @Column({ default: false })
  is_institution_member: boolean;

  @Column({ type: "simple-array", nullable: true })
  institution_ids: string[];

  @Column({
    type: "enum",
    enum: BwengeRole,
    nullable: true,
  })
  bwenge_role: BwengeRole;

  @Column({
    type: "enum",
    enum: InstitutionRole,
    nullable: true,
  })
  institution_role: InstitutionRole;

  @Column({ type: "simple-array", nullable: true })
  spoc_access_codes_used: string[];

  @Column({ type: "integer", default: 0 })
  enrolled_courses_count: number;

  @Column({ type: "integer", default: 0 })
  completed_courses_count: number;

  @Column({ type: "jsonb", nullable: true })
  learning_preferences: {
    preferred_language?: string;
    notification_settings?: any;
    learning_pace?: string;
    interests?: string[];
    theme?: string;
    two_factor_enabled?: boolean;
    last_password_change?: string;
  };

  @Column({ type: "timestamp", nullable: true })
  last_login_bwenge: Date;

  @Column({ default: false })
  bwenge_profile_completed: boolean;

  @Column({ type: "integer", default: 0 })
  total_learning_hours: number;

  @Column({ type: "integer", default: 0 })
  certificates_earned: number;

  @OneToOne(() => UserProfile, (profile) => profile.user)
  profile: UserProfile;

  @OneToMany(() => UserSession, (session) => session.user)
  sessions: UserSession[];

  @OneToMany(() => Course, (course) => course.instructor)
  courses_created: Course[];


@OneToMany(() => SavedCourse, (saved) => saved.user)
saved_courses: SavedCourse[];

  @OneToMany(() => Enrollment, (enrollment) => enrollment.user)
  enrollments: Enrollment[];

  @OneToMany(() => Certificate, (certificate) => certificate.user)
  certificates: Certificate[];

  @OneToMany(() => LessonProgress, (progress) => progress.user)
  lesson_progress: LessonProgress[];

  @OneToMany(() => InstitutionMember, (member) => member.user)
  institution_memberships: InstitutionMember[];

  @OneToMany(() => CourseInstructor, (instructor) => instructor.instructor)
  course_instructor_assignments: CourseInstructor[];

  @OneToMany(() => Answer, (answer) => answer.user)
  answers: Answer[];

  @OneToMany(() => Message, (message) => message.sender)
  sentMessages: Message[];

  @OneToMany(() => Conversation, (conversation) => conversation.student)
  studentConversations: Conversation[];

  @OneToMany(() => Conversation, (conversation) => conversation.instructor)
  instructorConversations: Conversation[];

  @OneToMany(() => UserRole, (userRole: UserRole) => userRole.user)
  user_roles: UserRole[];

  @UpdateDateColumn()
  updated_at: Date;

  private _originalBwengeRole: BwengeRole;
  private _originalIsForWhichSystem: SystemType;
  private _originalInstitutionIds: string[];
  private _originalInstitutionRole: InstitutionRole;
  private _originalPrimaryInstitutionId: string;
  private _originalIsInstitutionMember: boolean;

  @AfterLoad()
  storeOriginalValues() {
    this._originalBwengeRole = this.bwenge_role;
    this._originalIsForWhichSystem = this.IsForWhichSystem;
    this._originalInstitutionIds = this.institution_ids ? [...this.institution_ids] : [];
    this._originalInstitutionRole = this.institution_role;
    this._originalPrimaryInstitutionId = this.primary_institution_id;
    this._originalIsInstitutionMember = this.is_institution_member;
  }

  @BeforeUpdate()
  protectAllCriticalFields() {

    const monitor = require('../../utils/crossSystemMonitor').crossSystemMonitor;

    // Protect IsForWhichSystem
    if (this._originalIsForWhichSystem && !this.IsForWhichSystem) {
      monitor.logProtection({
        userId: this.id,
        system: 'ENTITY',
        field: 'IsForWhichSystem',
        action: 'attempted_null',
        oldValue: this._originalIsForWhichSystem,
        newValue: null,
        timestamp: new Date()
      });

      this.IsForWhichSystem = this._originalIsForWhichSystem;

      monitor.logProtection({
        userId: this.id,
        system: 'ENTITY',
        field: 'IsForWhichSystem',
        action: 'protected',
        oldValue: this._originalIsForWhichSystem,
        newValue: this._originalIsForWhichSystem,
        timestamp: new Date()
      });
    }

    // Protect BwengeRole
    if (this._originalBwengeRole && !this.bwenge_role) {
      this.bwenge_role = this._originalBwengeRole;
    }

    // Protect institution arrays - only add, never remove
    if (this._originalInstitutionIds && this._originalInstitutionIds.length > 0) {
      if (!this.institution_ids || this.institution_ids.length === 0) {
        this.institution_ids = [...this._originalInstitutionIds];
      } else {
        // Merge arrays: keep original + add new ones
        const mergedIds = [...new Set([...this._originalInstitutionIds, ...this.institution_ids])];
        if (mergedIds.length > this._originalInstitutionIds.length) {
          this.institution_ids = mergedIds;
        }
      }
    }

    // Protect institution role
    if (this._originalInstitutionRole && !this.institution_role) {
      this.institution_role = this._originalInstitutionRole;
    }

    // Protect primary institution
    if (this._originalPrimaryInstitutionId && !this.primary_institution_id) {
      this.primary_institution_id = this._originalPrimaryInstitutionId;
    }

    // Protect institution member flag
    if (this._originalIsInstitutionMember && !this.is_institution_member) {
      this.is_institution_member = true;
    }
  }

  setOriginalBwengeRole(role: BwengeRole) {
    this._originalBwengeRole = role;
  }
}