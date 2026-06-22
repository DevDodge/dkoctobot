import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMaxFiresToFollowUpStep1771000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE follow_up_step ADD COLUMN IF NOT EXISTS "maxFires" integer NOT NULL DEFAULT 0;`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE follow_up_step DROP COLUMN IF EXISTS "maxFires";`
    );
  }
}
