import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFollowUpSystem1770000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // FollowUpConfig table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`follow_up_config\` (
                \`id\` varchar(36) NOT NULL,
                \`chatflowId\` varchar(255) NOT NULL,
                \`enabled\` tinyint NOT NULL DEFAULT 0,
                \`includeSessionDetails\` tinyint NOT NULL DEFAULT 1,
                \`maxMessages\` int NOT NULL DEFAULT 10,
                \`createdDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`updatedDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB;`
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_follow_up_config_chatflowId\` ON \`follow_up_config\` (\`chatflowId\`);`
    );

    // FollowUpStep table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`follow_up_step\` (
                \`id\` varchar(36) NOT NULL,
                \`configId\` varchar(36) NOT NULL,
                \`chatflowId\` varchar(255) NOT NULL,
                \`stepOrder\` int NOT NULL,
                \`stepName\` varchar(255) NULL,
                \`idleTimeout\` int NOT NULL,
                \`idleTimeoutUnit\` varchar(20) NOT NULL DEFAULT 'minutes',
                \`webhookUrl\` text NOT NULL,
                \`webhookHeaders\` text NULL,
                \`createdDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`updatedDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB;`
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_follow_up_step_configId\` ON \`follow_up_step\` (\`configId\`);`
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_follow_up_step_chatflowId\` ON \`follow_up_step\` (\`chatflowId\`);`
    );

    // FollowUpLog table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`follow_up_log\` (
                \`id\` varchar(36) NOT NULL,
                \`chatflowId\` varchar(255) NOT NULL,
                \`chatId\` varchar(255) NOT NULL,
                \`stepId\` varchar(36) NULL,
                \`stepName\` varchar(255) NULL,
                \`stepOrder\` int NULL,
                \`status\` varchar(20) NOT NULL DEFAULT 'pending',
                \`webhookUrl\` text NULL,
                \`payload\` longtext NULL,
                \`responseStatus\` int NULL,
                \`responseBody\` longtext NULL,
                \`errorMessage\` text NULL,
                \`idleTimeout\` int NULL,
                \`idleTimeoutUnit\` varchar(20) NULL,
                \`lastMessageAt\` datetime NULL,
                \`firedAt\` datetime NULL,
                \`createdDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`retryCount\` int NOT NULL DEFAULT 0,
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB;`
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_follow_up_log_chatflowId\` ON \`follow_up_log\` (\`chatflowId\`);`
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_follow_up_log_chatId\` ON \`follow_up_log\` (\`chatId\`);`
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_follow_up_log_createdDate\` ON \`follow_up_log\` (\`createdDate\`);`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_follow_up_log_createdDate\` ON \`follow_up_log\``
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_follow_up_log_chatId\` ON \`follow_up_log\``
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_follow_up_log_chatflowId\` ON \`follow_up_log\``
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`follow_up_log\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_follow_up_step_chatflowId\` ON \`follow_up_step\``
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_follow_up_step_configId\` ON \`follow_up_step\``
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`follow_up_step\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_follow_up_config_chatflowId\` ON \`follow_up_config\``
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`follow_up_config\``);
  }
}
