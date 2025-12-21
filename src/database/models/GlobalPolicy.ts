import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";

export enum PolicyType {
  TERMS_OF_SERVICE = "TERMS_OF_SERVICE",
  PRIVACY_POLICY = "PRIVACY_POLICY",
  COOKIE_POLICY = "COOKIE_POLICY",
  DATA_PROCESSING = "DATA_PROCESSING",
  ACCEPTABLE_USE = "ACCEPTABLE_USE",
  REFUND_POLICY = "REFUND_POLICY",
  CANCELLATION_POLICY = "CANCELLATION_POLICY",
  SECURITY_POLICY = "SECURITY_POLICY",
  DMCA = "DMCA",
  GDPR = "GDPR",
  CUSTOM = "CUSTOM",
}

export enum PolicyStatus {
  DRAFT = "DRAFT",
  PUBLISHED = "PUBLISHED",
  ARCHIVED = "ARCHIVED",
}

@Entity("global_policies")
@Index(["type", "version"], { unique: true })
export class GlobalPolicy {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    type: "enum",
    enum: PolicyType,
  })
  @Index()
  type: PolicyType;

  @Column()
  title: string;

  @Column({ nullable: true })
  slug: string;

  @Column()
  version: string;

  @Column({ type: "text" })
  content: string;

  @Column({ type: "text", nullable: true })
  summary: string;

  @Column({ type: "jsonb", nullable: true })
  sections: {
    id: string;
    title: string;
    content: string;
    order: number;
  }[];

  @Column({
    type: "enum",
    enum: PolicyStatus,
    default: PolicyStatus.DRAFT,
  })
  status: PolicyStatus;

  @Column({ type: "timestamp", nullable: true })
  effective_date: Date;

  @Column({ type: "timestamp", nullable: true })
  expiry_date: Date;

  @Column({ type: "timestamp", nullable: true })
  published_at: Date;

  @Column({ type: "uuid", nullable: true })
  published_by_user_id: string;

  @Column({ default: false })
  requires_acceptance: boolean;

  @Column({ type: "integer", default: 0 })
  acceptance_count: number;

  @Column({ type: "jsonb", nullable: true })
  change_log: {
    version: string;
    date: Date;
    changes: string[];
    author: string;
  }[];

  @Column({ type: "jsonb", nullable: true })
  metadata: {
    language?: string;
    jurisdiction?: string[];
    applies_to?: ("all" | "students" | "instructors" | "institutions")[];
    last_reviewed?: Date;
    reviewed_by?: string;
    legal_notes?: string;
  };

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

@Entity("policy_acceptances")
export class PolicyAcceptance {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  @Index()
  policy_id: string;

  @ManyToOne(() => GlobalPolicy)
  @JoinColumn({ name: "policy_id" })
  policy: GlobalPolicy;

  @Column()
  @Index()
  user_id: string;

  @Column()
  policy_version: string;

  @Column({ type: "timestamp" })
  accepted_at: Date;

  @Column({ nullable: true })
  ip_address: string;

  @Column({ nullable: true })
  user_agent: string;

  @Column({ type: "jsonb", nullable: true })
  consent_data: any;
}