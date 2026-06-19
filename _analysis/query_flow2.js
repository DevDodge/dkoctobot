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
    SELECT id, name, "flowData"::text as "flowDataRaw", deployed, "isPublic",
           "apikeyid", "chatbotConfig", "apiConfig", "analytic",
           "speechToText", "followUpPrompts", "category"
    FROM chat_flow
    WHERE id = 'fef6f460-a037-480e-8adb-1063b29b54c6'
  `);

  if (res.rows.length === 0) {
    console.log("No row found.");
    await client.end();
    return;
  }

  const row = res.rows[0];
  console.log("=== METADATA ===");
  console.log("name:", row.name);
  console.log("deployed:", row.deployed);
  console.log("isPublic:", row.isPublic);
  console.log("apikeyid:", row.apikeyid);
  console.log("chatbotConfig:", row.chatbotConfig);
  console.log("apiConfig:", row.apiConfig);
  console.log("analytic:", row.analytic);
  console.log("speechToText:", row.speechToText);
  console.log("followUpPrompts:", row.followUpPrompts);
  console.log("category:", row.category);

  // Parse flowData
  let flowData;
  try {
    flowData = JSON.parse(row.flowDataRaw);
  } catch (e) {
    flowData = row.flowDataRaw;
  }
  console.log("\nflowData type:", typeof flowData);
  if (typeof flowData === "object" && flowData !== null) {
    console.log("flowData keys:", Object.keys(flowData));
    if (flowData.nodes) console.log("Nodes count:", flowData.nodes.length);
    if (flowData.edges) console.log("Edges count:", flowData.edges.length);

    if (flowData.nodes) {
      console.log("\n=== NODE TYPES ===");
      const counts = {};
      flowData.nodes.forEach((n) => {
        const label = (n.data && n.data.label) || n.type || "unknown";
        counts[label] = (counts[label] || 0) + 1;
      });
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, v]) => {
          console.log(`  ${k}: ${v}`);
        });
    }
  }

  // Save complete output with proper structure
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
    flowData: flowData,
  };

  fs.writeFileSync(
    "f:/DK-Platform/_analysis/broken_flow.json",
    JSON.stringify(output, null, 2)
  );
  console.log(
    "\nFull data saved to: f:/DK-Platform/_analysis/broken_flow.json"
  );
  const stats = fs.statSync("f:/DK-Platform/_analysis/broken_flow.json");
  console.log("File size:", (stats.size / 1024).toFixed(1), "KB");

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
