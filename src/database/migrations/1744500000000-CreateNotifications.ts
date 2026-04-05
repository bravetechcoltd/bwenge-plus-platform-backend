import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNotifications1744500000000 implements MigrationInterface {
  name = "CreateNotifications1744500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Clean up any leftover artifacts from a previous failed run
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."notifications_recipient_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."notifications_entity_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."notifications_notification_type_enum"`);

    // Create notification_type enum
    await queryRunner.query(`
      CREATE TYPE "public"."notifications_notification_type_enum" AS ENUM (
        'ENROLLMENT_APPROVED',
        'ENROLLMENT_REJECTED',
        'ENROLLMENT_PENDING',
        'ASSESSMENT_GRADED',
        'NEW_LESSON_PUBLISHED',
        'CERTIFICATE_ISSUED',
        'COURSE_DEADLINE_REMINDER',
        'NEW_ENROLLMENT_REQUEST',
        'NEW_INSTRUCTOR_JOINED',
        'NEW_STUDENT_JOINED',
        'COURSE_PUBLISHED',
        'COURSE_FLAGGED',
        'BULK_ENROLLMENT_COMPLETED',
        'ACCESS_CODE_USED',
        'NEW_INSTITUTION_REGISTRATION',
        'NEW_INSTITUTION_ADMIN',
        'CONTENT_MODERATION_FLAG',
        'SYSTEM_HEALTH_ALERT',
        'ENROLLMENT_SPIKE',
        'NEW_INSTRUCTOR_APPLICATION'
      )
    `);

    // Create entity_type enum
    await queryRunner.query(`
      CREATE TYPE "public"."notifications_entity_type_enum" AS ENUM (
        'ENROLLMENT',
        'COURSE',
        'INSTITUTION',
        'USER',
        'ASSESSMENT',
        'CERTIFICATE',
        'SYSTEM'
      )
    `);

    // Create recipient_role enum
    await queryRunner.query(`
      CREATE TYPE "public"."notifications_recipient_role_enum" AS ENUM (
        'SYSTEM_ADMIN',
        'INSTITUTION_ADMIN',
        'INSTRUCTOR',
        'LEARNER'
      )
    `);

    // Create notifications table
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"                 uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recipient_user_id"  uuid NOT NULL,
        "recipient_role"     "public"."notifications_recipient_role_enum" NOT NULL,
        "notification_type"  "public"."notifications_notification_type_enum" NOT NULL,
        "title"              character varying(255) NOT NULL,
        "body"               text NOT NULL,
        "entity_type"        "public"."notifications_entity_type_enum" NOT NULL,
        "entity_id"          uuid,
        "is_read"            boolean NOT NULL DEFAULT false,
        "read_at"            TIMESTAMP,
        "actor_user_id"      uuid,
        "institution_id"     uuid,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_recipient"
          FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_actor"
          FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Create indexes for fast queries
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient" ON "notifications" ("recipient_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_read" ON "notifications" ("recipient_user_id", "is_read")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_created" ON "notifications" ("recipient_user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_institution" ON "notifications" ("institution_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."notifications_recipient_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."notifications_entity_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."notifications_notification_type_enum"`);
  }
}
