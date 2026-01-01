import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddChatflowFolder1767000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "chatflow_folder" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" varchar NOT NULL,
                "workspaceId" text NOT NULL,
                "createdDate" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedDate" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_chatflow_folder" PRIMARY KEY ("id")
            );
        `)
        await queryRunner.query(`ALTER TABLE "chat_flow" ADD COLUMN IF NOT EXISTS "folderId" TEXT;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_flow" DROP COLUMN "folderId";`)
        await queryRunner.query(`DROP TABLE "chatflow_folder";`)
    }
}
