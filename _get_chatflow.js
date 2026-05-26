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
    console.log("Name:", flow.name);
    console.log(
      "Flow Data:",
      JSON.stringify(JSON.parse(flow.flowData), null, 2)
    );
  }
  await c.end();
}
main().catch(console.error);
