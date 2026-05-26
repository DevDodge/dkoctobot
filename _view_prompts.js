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
    const flowData = JSON.parse(r.rows[0].flowData);

    console.log("--- Prompts in Chatflow ---");
    flowData.nodes.forEach((n) => {
      if (
        n.type === "ChatPromptTemplate" ||
        n.type === "PromptTemplate" ||
        (n.name && n.name.includes("Prompt")) ||
        (n.label && n.label.includes("Prompt"))
      ) {
        console.log(`Node: ${n.id} (${n.label})`);
        if (n.inputs) {
          n.inputs.forEach((i) => {
            if (
              i.name === "promptValues" ||
              i.name === "template" ||
              i.name === "systemMessage" ||
              i.name === "humanMessage"
            ) {
              console.log(`  Input: ${i.name} ->`, i.value);
            }
          });
        }
      }
    });
  }
  await c.end();
}
main().catch(console.error);
