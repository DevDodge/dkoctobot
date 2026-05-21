import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddSupervisorLog1769000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS supervisor_log (
                id uuid NOT NULL DEFAULT uuid_generate_v4(),
                "chatflowid" uuid NOT NULL,
                "chatId" varchar,
                "sessionId" varchar,
                "userInput" text,
                "originalOutput" text,
                "correctedOutput" text,
                "violations" text,
                "feedback" text,
                "attempt" integer NOT NULL DEFAULT 1,
                "approved" boolean NOT NULL DEFAULT false,
                "confidence" float,
                "chatflowName" varchar,
                "createdDate" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "PK_supervisor_log_id" PRIMARY KEY (id)
            );`
        )

        // Add index on chatflowid for faster lookups
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_supervisor_log_chatflowid" ON supervisor_log ("chatflowid");`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_supervisor_log_chatflowid"`)
        await queryRunner.query(`DROP TABLE IF EXISTS supervisor_log`)
    }
}
