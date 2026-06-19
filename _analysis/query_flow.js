const { Client } = require("pg");
const fs = require("fs");

const client = new Client({
  host: "localhost",
  port: 10034,
  database: "dk_octobot",
  user: "postgres",
  password: "Eng.OctoBot-DK-Kareem-DODGE.12",
});

async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT id, name, "flowData", deployed, "isPublic", "apikeyid",
           "chatbotConfig", "apiConfig", "analytic", "speechToText",
           "followUpPrompts", "category"
    FROM chat_flow
    WHERE id = 'fef6f460-a037-480e-8adb-1063b29b54c6'
  `);

  if (res.rows.length === 0) {
    console.log("No row found for this ID.");
    await client.end();
    return;
  }

  const row = res.rows[0];
  console.log("=== METADATA ===");
  console.log("name:", row.name);
  console.log("deployed:", row.deployed);
  console.log("apikeyid:", row.apikeyid);
  console.log("chatbotConfig:", row.chatbotConfig);
  console.log("flowData length:", (row.flowData || "").length, "chars");

  // Save full output to file
  const output = {
    id: row.id,
    name: row.name,
    deployed: row.deployed,
    isPublic: row.isPublic,
    apikeyid: row.apikeyid,
    chatbotConfig: row.chatbotConfig,
    apiConfig: row.apiConfig,
    analytic: row.analytic,
    speechToText: row.speechToText,
    followUpPrompts: row.followUpPrompts,
    category: row.category,
    flowData: row.flowData,
  };

  fs.writeFileSync(
    "f:/DK-Platform/_analysis/broken_flow.json",
    JSON.stringify(output, null, 2)
  );
  console.log(
    "\nFull data saved to: f:/DK-Platform/_analysis/broken_flow.json"
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
