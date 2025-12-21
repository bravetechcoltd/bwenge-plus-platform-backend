import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
    Unique,
} from "typeorm";
import { User } from "./User";
import { Course } from "./Course";
import { Lesson } from "./Lesson";
import { Assessment } from "./Assessment";
import { Enrollment } from "./Enrollment";

@Entity("progress")
@Unique(["user_id", "course_id", "lesson_id", "assessment_id"])
export class Progress {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    // ==================== FIXED: Make user_id NULLABLE ====================
    @Column({ type: "uuid", nullable: true })
    @Index()
    user_id: string | null;

    @ManyToOne(() => User, (user) => user.progress_records, {
        onDelete: "CASCADE",
        nullable: true
    })
    @JoinColumn({ name: "user_id" })
    user: User | null;

    @Column({ type: "uuid" })
    @Index()
    course_id: string;

    @ManyToOne(() => Course, (course) => course.progress_records, { onDelete: "CASCADE" })
    @JoinColumn({ name: "course_id" })
    course: Course;

    // ==================== FIXED: Make enrollment_id NULLABLE ====================
    @Column({ type: "uuid", nullable: true })
    @Index()
    enrollment_id: string | null;

    @ManyToOne(() => Enrollment, (enrollment) => enrollment.progress_records, {
        onDelete: "CASCADE",
        nullable: true
    })
    @JoinColumn({ name: "enrollment_id" })
    enrollment: Enrollment | null;

    @Column({ type: "uuid", nullable: true })
    @Index()
    lesson_id: string | null;

    @ManyToOne(() => Lesson, (lesson) => lesson.progress_records, {
        nullable: true,
        onDelete: "CASCADE",
    })
    @JoinColumn({ name: "lesson_id" })
    lesson: Lesson | null;

    @Column({ type: "uuid", nullable: true })
    @Index()

    @Column({ type: "uuid", nullable: true })
    assessment_id: string | null;

    @ManyToOne(() => Assessment, { nullable: true, onDelete: "CASCADE" })
    assessment: Assessment | null;

    @Column({ default: false })
    is_completed: boolean;

    @Column({ type: "text", nullable: true })
    status: string | null;

    @Column({ type: "float", nullable: true })
    score: number | null;

    @Column({ type: "float", default: 0 })
    completion_percentage: number;

    @Column({ type: "integer", default: 0 })
    time_spent_seconds: number;

    @Column({ type: "integer", nullable: true })
    attempt_count: number;

    @Column({ type: "jsonb", nullable: true })
    answers: any;

    @Column({ type: "jsonb", nullable: true })
    notes: string;

    @CreateDateColumn()
    started_at: Date;

    @Column({ type: "timestamp", nullable: true })
    completed_at: Date;

    @UpdateDateColumn()
    last_accessed_at: Date;
}