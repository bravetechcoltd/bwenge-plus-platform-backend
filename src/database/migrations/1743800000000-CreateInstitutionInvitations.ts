import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInstitutionInvitations1743800000000 implements MigrationInterface {
  name = "CreateInstitutionInvitations1743800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make sure uuid_generate_v4() is available
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ---- institution_invitations ----
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."institution_invitations_status_enum"
          AS ENUM ('pending', 'accepted', 'expired', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."institution_invitations_type_enum"
          AS ENUM ('email', 'link');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "institution_invitations" (
        "id"             uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "institution_id" uuid        NOT NULL,
        "email"          character varying,
        "role"           character varying,
        "status"         "public"."institution_invitations_status_enum" NOT NULL DEFAULT 'pending',
        "type"           "public"."institution_invitations_type_enum"   NOT NULL DEFAULT 'email',
        "invited_by"     uuid,
        "message"        text,
        "token"          character varying UNIQUE,
        "expires_at"     TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_institution_invitations" PRIMARY KEY ("id")
      )
    `);

    // FKs are added via ALTER TABLE so we can tolerate incompatible-type
    // drift (SQLSTATE 42804) on legacy databases where "institutions"."id"
    // or "users"."id" may not be uuid. The table and all columns are still
    // created unchanged; only the DB-level FK is skipped when impossible.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "institution_invitations"
          ADD CONSTRAINT "FK_inv_institution"
          FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN datatype_mismatch THEN NULL;
        WHEN undefined_table THEN NULL;
        WHEN undefined_column THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "institution_invitations"
          ADD CONSTRAINT "FK_inv_user"
          FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN datatype_mismatch THEN NULL;
        WHEN undefined_table THEN NULL;
        WHEN undefined_column THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inv_institution_id"
        ON "institution_invitations" ("institution_id")
    `);

    // ---- bulk_import_jobs ----
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."bulk_import_jobs_status_enum"
          AS ENUM ('pending', 'processing', 'completed', 'failed');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bulk_import_jobs" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "institution_id" uuid NOT NULL,
        "status"         "public"."bulk_import_jobs_status_enum" NOT NULL DEFAULT 'pending',
        "total"          integer NOT NULL DEFAULT 0,
        "processed"      integer NOT NULL DEFAULT 0,
        "succeeded"      integer NOT NULL DEFAULT 0,
        "failed"         integer NOT NULL DEFAULT 0,
        "errors"         jsonb,
        "created_by"     uuid,
        "completed_at"   TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bulk_import_jobs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "bulk_import_jobs"
          ADD CONSTRAINT "FK_bij_institution"
          FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN datatype_mismatch THEN NULL;
        WHEN undefined_table THEN NULL;
        WHEN undefined_column THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "bulk_import_jobs"
          ADD CONSTRAINT "FK_bij_user"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN datatype_mismatch THEN NULL;
        WHEN undefined_table THEN NULL;
        WHEN undefined_column THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bij_institution_id"
        ON "bulk_import_jobs" ("institution_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bij_institution_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bulk_import_jobs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."bulk_import_jobs_status_enum"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_inv_institution_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "institution_invitations"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."institution_invitations_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."institution_invitations_status_enum"`);
  }
}
