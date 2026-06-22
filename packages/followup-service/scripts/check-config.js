const { Pool } = require('pg');

const pool = new Pool({
  host: '178.63.34.211',
  port: 10034,
  user: 'postgres',
  password: 'Eng.OctoBot-DK-Kareem-DODGE.12',
  database: 'dk_octobot'
});

async function check() {
  try {
    console.log('Checking follow_up_config table...\n');
    const result = await pool.query(
      `SELECT id, "chatflowId", enabled, "chatIdFilterRegex" FROM follow_up_config ORDER BY "updatedDate" DESC LIMIT 5;`
    );
    console.log('Recent configs:');
    console.table(result.rows);
  } catch (error) {
    console.error('Query failed:', error.message);
  } finally {
    await pool.end();
  }
}

check();
