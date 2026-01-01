import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddChatflowFolder1767000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "chatflow_folder" (
                "id" varchar PRIMARY KEY NOT NULL,
                "name" varchar NOT NULL,
                "workspaceId" text NOT NULL,
                "createdDate" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedDate" datetime NOT NULL DEFAULT (datetime('now'))
            );
        `)
        await queryRunner.query(`ALTER TABLE "chat_flow" ADD COLUMN "folderId" TEXT;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_flow" DROP COLUMN "folderId";`)
        await queryRunner.query(`DROP TABLE "chatflow_folder";`)
    }
}
