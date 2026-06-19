import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFollowUpSystem1770000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // FollowUpConfig table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "follow_up_config" (
                "id" varchar PRIMARY KEY NOT NULL,
                "chatflowId" varchar NOT NULL,
                "enabled" boolean NOT NULL DEFAULT (0),
                "includeSessionDetails" boolean NOT NULL DEFAULT (1),
                "maxMessages" integer NOT NULL DEFAULT (10),
                "createdDate" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedDate" datetime NOT NULL DEFAULT (datetime('now'))
            );
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_config_chatflowId" ON "follow_up_config" ("chatflowId");`
    );

    // FollowUpStep table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "follow_up_step" (
                "id" varchar PRIMARY KEY NOT NULL,
                "configId" varchar NOT NULL,
                "chatflowId" varchar NOT NULL,
                "stepOrder" integer NOT NULL,
                "stepName" varchar,
                "idleTimeout" integer NOT NULL,
                "idleTimeoutUnit" varchar NOT NULL DEFAULT ('minutes'),
                "webhookUrl" text NOT NULL,
                "webhookHeaders" text,
                "createdDate" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedDate" datetime NOT NULL DEFAULT (datetime('now'))
            );
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_step_configId" ON "follow_up_step" ("configId");`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_step_chatflowId" ON "follow_up_step" ("chatflowId");`
    );

    // FollowUpLog table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "follow_up_log" (
                "id" varchar PRIMARY KEY NOT NULL,
                "chatflowId" varchar NOT NULL,
                "chatId" varchar NOT NULL,
                "stepId" varchar,
                "stepName" varchar,
                "stepOrder" integer,
                "status" varchar NOT NULL DEFAULT ('pending'),
                "webhookUrl" text,
                "payload" text,
                "responseStatus" integer,
                "responseBody" text,
                "errorMessage" text,
                "idleTimeout" integer,
                "idleTimeoutUnit" varchar,
                "lastMessageAt" datetime,
                "firedAt" datetime,
                "createdDate" datetime NOT NULL DEFAULT (datetime('now')),
                "retryCount" integer NOT NULL DEFAULT (0)
            );
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_log_chatflowId" ON "follow_up_log" ("chatflowId");`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_log_chatId" ON "follow_up_log" ("chatId");`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_log_createdDate" ON "follow_up_log" ("createdDate");`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_log_createdDate"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_follow_up_log_chatId"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_log_chatflowId"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "follow_up_log"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_step_chatflowId"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_step_configId"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "follow_up_step"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_config_chatflowId"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "follow_up_config"`);
  }
}
