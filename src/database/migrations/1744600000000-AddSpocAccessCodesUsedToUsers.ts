import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSpocAccessCodesUsedToUsers1744600000000 implements MigrationInterface {
  name = "AddSpocAccessCodesUsedToUsers1744600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add all missing User columns idempotently.
    // Each column is guarded so re-running the migration is safe.

    const columns = [
      { name: "spoc_access_codes_used", sql: `text[] DEFAULT '{}'` },
      { name: "enrolled_courses_count", sql: `integer NOT NULL DEFAULT 0` },
      { name: "completed_courses_count", sql: `integer NOT NULL DEFAULT 0` },
      { name: "learning_preferences", sql: `jsonb` },
      { name: "last_login_bwenge", sql: `TIMESTAMP` },
      { name: "bwenge_profile_completed", sql: `boolean NOT NULL DEFAULT false` },
      { name: "total_learning_hours", sql: `integer NOT NULL DEFAULT 0` },
      { name: "certificates_earned", sql: `integer NOT NULL DEFAULT 0` },
    ];

    for (const col of columns) {
      const exists = await queryRunner.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = '${col.name}'
      `);

      if (exists.length === 0) {
        await queryRunner.query(
          `ALTER TABLE "users" ADD COLUMN "${col.name}" ${col.sql}`
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const columns = [
      "spoc_access_codes_used",
      "enrolled_courses_count",
      "completed_courses_count",
      "learning_preferences",
      "last_login_bwenge",
      "bwenge_profile_completed",
      "total_learning_hours",
      "certificates_earned",
    ];

    for (const col of columns) {
      await queryRunner.query(
        `ALTER TABLE "users" DROP COLUMN IF EXISTS "${col}"`
      );
    }
  }
}
