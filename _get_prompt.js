const { Client } = require("pg");
async function main() {
  const c = new Client({
    host: "localhost",
    port: 10034,
    user: "postgres",
    password: "Eng.OctoBot-DK-Kareem-DODGE.12",
    database: "dk_octobot",
  });
  await c.connect();
  const r = await c.query(
    "SELECT * FROM chat_flow WHERE id = 'bc5c6489-05bd-4946-9383-b4e8fdfd020e'"
  );
  if (r.rows.length === 0) {
    console.log("Chatflow not found!");
  } else {
    const flow = r.rows[0];
    const data = JSON.parse(flow.flowData);
    for (const node of data.nodes) {
      if (
        node.id === "chatPromptTemplate_0" ||
        node.id === "erpAgentPrompt_0" ||
        node.id.includes("Prompt") ||
        node.id.includes("agent") ||
        node.id.includes("Agent")
      ) {
        console.log("--- NODE ID:", node.id, "Label:", node.data.label, "---");
        console.log("Inputs:", JSON.stringify(node.data.inputs, null, 2));
      }
    }
  }
  await c.end();
}
main().catch(console.error);
