import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInstitutionInvitations1743800000000 implements MigrationInterface {
  name = "CreateInstitutionInvitations1743800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- institution_invitations ----
    await queryRunner.query(`
      CREATE TYPE "public"."institution_invitations_status_enum"
        AS ENUM ('pending', 'accepted', 'expired', 'cancelled')
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."institution_invitations_type_enum"
        AS ENUM ('email', 'link')
    `);

    await queryRunner.query(`
      CREATE TABLE "institution_invitations" (
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
        CONSTRAINT "PK_institution_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inv_institution"
          FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inv_user"
          FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_inv_institution_id"
        ON "institution_invitations" ("institution_id")
    `);

    // ---- bulk_import_jobs ----
    await queryRunner.query(`
      CREATE TYPE "public"."bulk_import_jobs_status_enum"
        AS ENUM ('pending', 'processing', 'completed', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "bulk_import_jobs" (
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
        CONSTRAINT "PK_bulk_import_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bij_institution"
          FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_bij_user"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_bij_institution_id"
        ON "bulk_import_jobs" ("institution_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_bij_institution_id"`);
    await queryRunner.query(`DROP TABLE "bulk_import_jobs"`);
    await queryRunner.query(`DROP TYPE "public"."bulk_import_jobs_status_enum"`);

    await queryRunner.query(`DROP INDEX "IDX_inv_institution_id"`);
    await queryRunner.query(`DROP TABLE "institution_invitations"`);
    await queryRunner.query(`DROP TYPE "public"."institution_invitations_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."institution_invitations_status_enum"`);
  }
}
