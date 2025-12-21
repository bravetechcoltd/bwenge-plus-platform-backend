import { DataSource } from "typeorm";

/**
 * Idempotent table/column bootstrap.
 * Creates tables that don't exist and adds missing columns to existing ones.
 * Safe to run on every server startup.
 */
export async function ensureTables(ds: DataSource): Promise<void> {
  const qr = ds.createQueryRunner();
  await qr.connect();
  try {

    // ── Enums ────────────────────────────────────────────────────────────────

    await qr.query(`
      DO $$ BEGIN
        CREATE TYPE institution_invitations_status_enum AS ENUM
          ('pending', 'accepted', 'expired', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // Add 'cancelled' value to the existing enum if it was created without it
    await qr.query(`
      DO $$ BEGIN
        ALTER TYPE institution_invitations_status_enum ADD VALUE IF NOT EXISTS 'cancelled';
      EXCEPTION WHEN others THEN NULL; END $$
    `);

    await qr.query(`
      DO $$ BEGIN
        CREATE TYPE institution_invitations_type_enum AS ENUM ('email', 'link');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await qr.query(`
      DO $$ BEGIN
        CREATE TYPE bulk_import_jobs_status_enum AS ENUM
          ('pending', 'processing', 'completed', 'failed');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // ── institution_invitations (create or patch) ─────────────────────────────

    await qr.query(`
      CREATE TABLE IF NOT EXISTS "institution_invitations" (
        "id"             uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "institution_id" uuid        NOT NULL,
        "email"          character varying,
        "role"           character varying,
        "status"         institution_invitations_status_enum NOT NULL DEFAULT 'pending',
        "type"           institution_invitations_type_enum   NOT NULL DEFAULT 'email',
        "invited_by"     uuid,
        "message"        text,
        "token"          character varying UNIQUE,
        "expires_at"     TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_institution_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inv_institution"
          FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inv_user"
          FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Patch columns that may be missing on a table created by an older migration
    await qr.query(`
      ALTER TABLE "institution_invitations"
        ADD COLUMN IF NOT EXISTS "type"       institution_invitations_type_enum NOT NULL DEFAULT 'email',
        ADD COLUMN IF NOT EXISTS "token"      character varying,
        ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP
    `);

    // email must be nullable for link-type invitations (no email needed)
    await qr.query(`
      ALTER TABLE "institution_invitations" ALTER COLUMN "email" DROP NOT NULL
    `);

    // Unique constraint on token (ignore if already exists)
    await qr.query(`
      DO $$ BEGIN
        ALTER TABLE "institution_invitations" ADD CONSTRAINT "UQ_inv_token" UNIQUE ("token");
      EXCEPTION WHEN duplicate_table THEN NULL;
               WHEN duplicate_object THEN NULL; END $$
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inv_institution_id"
        ON "institution_invitations" ("institution_id")
    `);

    // ── bulk_import_jobs (create) ─────────────────────────────────────────────

    await qr.query(`
      CREATE TABLE IF NOT EXISTS "bulk_import_jobs" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "institution_id" uuid NOT NULL,
        "status"         bulk_import_jobs_status_enum NOT NULL DEFAULT 'pending',
        "total"          integer NOT NULL DEFAULT 0,
        "processed"      integer NOT NULL DEFAULT 0,
        "succeeded"      integer NOT NULL DEFAULT 0,
        "failed"         integer NOT NULL DEFAULT 0,
        "errors"         jsonb,
        "created_by"     uuid,
        "completed_at"   TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bulk_import_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bij_institution"
          FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_bij_user"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bij_institution_id"
        ON "bulk_import_jobs" ("institution_id")
    `);

    // ── message table: add isEdited + reactions + deletedAt columns ──────────
    await qr.query(`
      ALTER TABLE "message"
        ADD COLUMN IF NOT EXISTS "isEdited"   boolean   NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "reactions"  jsonb     NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "deletedAt"  TIMESTAMP
    `);

    // ── space_message table: add isEdited + deletedAt columns ─────────────────
    await qr.query(`
      ALTER TABLE "space_message"
        ADD COLUMN IF NOT EXISTS "isEdited"  boolean   NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP
    `);

    // ── message_reaction table ────────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "message_reaction" (
        "id"         uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "messageId"  uuid        NOT NULL,
        "userId"     uuid        NOT NULL,
        "emoji"      varchar(8)  NOT NULL,
        "createdAt"  TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_message_reaction" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_message_reaction_unique"
          UNIQUE ("messageId", "userId", "emoji")
      )
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS "IDX_mr_messageId"
        ON "message_reaction" ("messageId")
    `);

    // ── users table: add application fields ──────────────────────────────────
    await qr.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_application_status_enum') THEN
          CREATE TYPE users_application_status_enum AS ENUM ('pending', 'approved', 'rejected');
        END IF;
      END $$;
    `);

    await qr.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "application_status" users_application_status_enum,
        ADD COLUMN IF NOT EXISTS "applied_at"          TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "rejection_reason"    TEXT
    `);

    console.log("✅ ensureTables: schema is up to date");
  } catch (err) {
    console.error("❌ ensureTables error:", err);
    throw err;
  } finally {
    await qr.release();
  }
}
