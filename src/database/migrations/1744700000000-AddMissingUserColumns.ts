import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMissingUserColumns1744700000000 implements MigrationInterface {
  name = "AddMissingUserColumns1744700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns = [
      { name: "enrolled_courses_count", sql: `integer NOT NULL DEFAULT 0` },
      { name: "completed_courses_count", sql: `integer NOT NULL DEFAULT 0` },
      { name: "learning_preferences", sql: `jsonb` },
      { name: "last_login_bwenge", sql: `TIMESTAMP` },
      { name: "bwenge_profile_completed", sql: `boolean NOT NULL DEFAULT false` },
      { name: "total_learning_hours", sql: `integer NOT NULL DEFAULT 0` },
      { name: "certificates_earned", sql: `integer NOT NULL DEFAULT 0` },
      { name: "updated_at", sql: `TIMESTAMP NOT NULL DEFAULT now()` },
    ];

    for (const col of columns) {
      const exists = await queryRunner.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = '${col.name}'`
      );

      if (exists.length === 0) {
        await queryRunner.query(
          `ALTER TABLE "users" ADD COLUMN "${col.name}" ${col.sql}`
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const columns = [
      "enrolled_courses_count",
      "completed_courses_count",
      "learning_preferences",
      "last_login_bwenge",
      "bwenge_profile_completed",
      "total_learning_hours",
      "certificates_earned",
      "updated_at",
    ];

    for (const col of columns) {
      await queryRunner.query(
        `ALTER TABLE "users" DROP COLUMN IF EXISTS "${col}"`
      );
    }
  }
}
