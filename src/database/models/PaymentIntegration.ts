import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from "typeorm";

export enum PaymentProvider {
  STRIPE = "STRIPE",
  PAYPAL = "PAYPAL",
  FLUTTERWAVE = "FLUTTERWAVE",
  PAYSTACK = "PAYSTACK",
  MPESA = "MPESA",
  CUSTOM = "CUSTOM",
}

export enum PaymentEnvironment {
  SANDBOX = "SANDBOX",
  PRODUCTION = "PRODUCTION",
}

export enum PaymentStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  MAINTENANCE = "MAINTENANCE",
  ERROR = "ERROR",
}

@Entity("payment_integrations")
export class PaymentIntegration {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    type: "enum",
    enum: PaymentProvider,
  })
  @Index()
  provider: PaymentProvider;

  @Column()
  display_name: string;

  @Column({
    type: "enum",
    enum: PaymentEnvironment,
    default: PaymentEnvironment.SANDBOX,
  })
  environment: PaymentEnvironment;

  @Column({
    type: "enum",
    enum: PaymentStatus,
    default: PaymentStatus.ACTIVE,
  })
  status: PaymentStatus;

  @Column({ type: "jsonb" })
  credentials: {
    api_key?: string;
    secret_key?: string;
    public_key?: string;
    webhook_secret?: string;
    merchant_id?: string;
    business_code?: string;
    [key: string]: any;
  };

  @Column({ type: "jsonb", nullable: true })
  webhook_config: {
    url?: string;
    events?: string[];
    secret?: string;
    enabled?: boolean;
  };

  @Column({ type: "jsonb", nullable: true })
  supported_currencies: string[];

  @Column({ type: "jsonb", nullable: true })
  supported_payment_methods: string[];

  @Column({ type: "decimal", precision: 5, scale: 2, default: 0 })
  transaction_fee_percentage: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  transaction_fee_fixed: number;

  @Column({ type: "jsonb", nullable: true })
  fee_structure: {
    domestic?: number;
    international?: number;
    card?: number;
    mobile_money?: number;
  };

  @Column({ type: "jsonb", nullable: true })
  settings: {
    auto_capture?: boolean;
    allow_refunds?: boolean;
    allow_partial_refunds?: boolean;
    require_3d_secure?: boolean;
    sandbox_mode?: boolean;
    debug_mode?: boolean;
    webhook_enabled?: boolean;
    [key: string]: any;
  };

  @Column({ type: "jsonb", nullable: true })
  metadata: {
    logo_url?: string;
    website?: string;
    documentation_url?: string;
    support_email?: string;
    support_phone?: string;
  };

  @Column({ default: false })
  is_default: boolean;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: "timestamp", nullable: true })
  last_webhook_received_at: Date;

  @Column({ type: "timestamp", nullable: true })
  last_transaction_at: Date;

  @Column({ type: "jsonb", nullable: true })
  health_check: {
    last_check: Date;
    status: "healthy" | "degraded" | "down";
    latency_ms?: number;
    error?: string;
  };

  @Column({ type: "text", nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

@Entity("payment_transactions")
export class PaymentTransaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  @Index()
  integration_id: string;

  @ManyToOne(() => PaymentIntegration)
  @JoinColumn({ name: "integration_id" })
  integration: PaymentIntegration;

  @Column({ type: "uuid", nullable: true })
  @Index()
  user_id: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  course_id: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  enrollment_id: string;

  @Column({ unique: true })
  @Index()
  transaction_reference: string;

  @Column({ nullable: true })
  provider_reference: string;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  amount: number;

  @Column({ length: 3 })
  currency: string;

  @Column({ type: "decimal", precision: 5, scale: 2, default: 0 })
  fee_amount: number;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  net_amount: number;

  @Column()
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";

  @Column({ nullable: true })
  payment_method: string;

  @Column({ type: "jsonb", nullable: true })
  payment_details: any;

  @Column({ type: "jsonb", nullable: true })
  provider_response: any;

  @Column({ type: "timestamp", nullable: true })
  paid_at: Date;

  @Column({ type: "text", nullable: true })
  failure_reason: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}