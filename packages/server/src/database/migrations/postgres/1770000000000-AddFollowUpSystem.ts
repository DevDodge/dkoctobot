import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFollowUpSystem1770000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // FollowUpConfig table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS follow_up_config (
                id uuid NOT NULL DEFAULT uuid_generate_v4(),
                "chatflowId" varchar NOT NULL,
                "enabled" boolean NOT NULL DEFAULT false,
                "includeSessionDetails" boolean NOT NULL DEFAULT true,
                "maxMessages" integer NOT NULL DEFAULT 10,
                "createdDate" timestamp NOT NULL DEFAULT now(),
                "updatedDate" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "PK_follow_up_config_id" PRIMARY KEY (id)
            );`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_config_chatflowId" ON follow_up_config ("chatflowId");`
    );

    // FollowUpStep table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS follow_up_step (
                id uuid NOT NULL DEFAULT uuid_generate_v4(),
                "configId" uuid NOT NULL,
                "chatflowId" varchar NOT NULL,
                "stepOrder" integer NOT NULL,
                "stepName" varchar,
                "idleTimeout" integer NOT NULL,
                "idleTimeoutUnit" varchar NOT NULL DEFAULT 'minutes',
                "webhookUrl" text NOT NULL,
                "webhookHeaders" text,
                "createdDate" timestamp NOT NULL DEFAULT now(),
                "updatedDate" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "PK_follow_up_step_id" PRIMARY KEY (id)
            );`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_step_configId" ON follow_up_step ("configId");`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_step_chatflowId" ON follow_up_step ("chatflowId");`
    );

    // FollowUpLog table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS follow_up_log (
                id uuid NOT NULL DEFAULT uuid_generate_v4(),
                "chatflowId" varchar NOT NULL,
                "chatId" varchar NOT NULL,
                "stepId" uuid,
                "stepName" varchar,
                "stepOrder" integer,
                "status" varchar NOT NULL DEFAULT 'pending',
                "webhookUrl" text,
                "payload" text,
                "responseStatus" integer,
                "responseBody" text,
                "errorMessage" text,
                "idleTimeout" integer,
                "idleTimeoutUnit" varchar,
                "lastMessageAt" timestamp,
                "firedAt" timestamp,
                "createdDate" timestamp NOT NULL DEFAULT now(),
                "retryCount" integer NOT NULL DEFAULT 0,
                CONSTRAINT "PK_follow_up_log_id" PRIMARY KEY (id)
            );`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_log_chatflowId" ON follow_up_log ("chatflowId");`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_log_chatId" ON follow_up_log ("chatId");`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_follow_up_log_createdDate" ON follow_up_log ("createdDate");`
    );

    // Composite index on chat_message for fast last-user-message lookup (used by Worker validation)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_message_followup_lookup" ON chat_message ("chatflowid", "chatId", "role", "createdDate" DESC);`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_chat_message_followup_lookup"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_log_createdDate"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_follow_up_log_chatId"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_log_chatflowId"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS follow_up_log`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_step_chatflowId"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_step_configId"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS follow_up_step`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_follow_up_config_chatflowId"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS follow_up_config`);
  }
}
