import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum ConfigType {
  SYSTEM = "SYSTEM",
  SECURITY = "SECURITY",
  EMAIL = "EMAIL",
  STORAGE = "STORAGE",
  FEATURE = "FEATURE",
  LOCALIZATION = "LOCALIZATION",
}

export enum ConfigDataType {
  STRING = "STRING",
  NUMBER = "NUMBER",
  BOOLEAN = "BOOLEAN",
  JSON = "JSON",
  ARRAY = "ARRAY",
}

@Entity("platform_configurations")
@Index(["key", "type"], { unique: true })
export class PlatformConfiguration {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  key: string;

  @Column()
  display_name: string;

  @Column({
    type: "enum",
    enum: ConfigType,
    default: ConfigType.SYSTEM,
  })
  type: ConfigType;

  @Column({
    type: "enum",
    enum: ConfigDataType,
    default: ConfigDataType.STRING,
  })
  data_type: ConfigDataType;

  @Column({ type: "text", nullable: true })
  value: string;

  @Column({ type: "jsonb", nullable: true })
  json_value: any;

  @Column({ type: "simple-array", nullable: true })
  array_value: string[];

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "jsonb", nullable: true })
  validation_rules: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
    options?: string[];
    depends_on?: string;
  };

  @Column({ type: "jsonb", nullable: true })
  metadata: {
    category?: string;
    order?: number;
    is_sensitive?: boolean;
    is_encrypted?: boolean;
    ui_component?: "input" | "textarea" | "select" | "checkbox" | "radio" | "json";
    ui_options?: any;
  };

  @Column({ default: true })
  is_active: boolean;

  @Column({ default: false })
  requires_restart: boolean;

  @Column({ type: "uuid", nullable: true })
  updated_by_user_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}