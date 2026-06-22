import { MigrationInterface, QueryRunner } from "typeorm";

export class AddChatIdFilterRegexToFollowUpConfig1772000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE follow_up_config ADD COLUMN IF NOT EXISTS "chatIdFilterRegex" text;`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE follow_up_config DROP COLUMN IF EXISTS "chatIdFilterRegex";`
    );
  }
}
