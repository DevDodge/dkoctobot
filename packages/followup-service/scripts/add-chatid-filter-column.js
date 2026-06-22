const { Pool } = require('pg');

const pool = new Pool({
  host: '178.63.34.211',
  port: 10034,
  user: 'postgres',
  password: 'Eng.OctoBot-DK-Kareem-DODGE.12',
  database: 'dk_octobot'
});

async function migrate() {
  try {
    console.log('Adding chatIdFilterRegex column to follow_up_config...');
    await pool.query(
      `ALTER TABLE follow_up_config ADD COLUMN IF NOT EXISTS "chatIdFilterRegex" text;`
    );
    console.log('✓ Column added successfully');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
