const fs = require("fs");

const raw = fs.readFileSync(
  "f:/DK-Platform/_analysis/broken_flow.json",
  "utf8"
);
const data = JSON.parse(raw);

console.log("=== TOP-LEVEL FIELDS ===");
console.log("id:", data.id);
console.log("name:", data.name);
console.log("deployed:", data.deployed);
console.log("isPublic:", data.isPublic);
console.log("apikeyid:", data.apikeyid);
console.log("chatbotConfig:", data.chatbotConfig);
console.log("apiConfig:", data.apiConfig);
console.log("analytic:", data.analytic);
console.log("speechToText:", data.speechToText);
console.log("followUpPrompts:", data.followUpPrompts);
console.log("category:", data.category);
console.log("flowData type:", typeof data.flowData);
console.log(
  "flowData length:",
  data.flowData ? String(data.flowData).length : 0
);

if (data.flowData) {
  let fd;
  try {
    fd =
      typeof data.flowData === "string"
        ? JSON.parse(data.flowData)
        : data.flowData;
  } catch (e) {
    console.log("flowData is not valid JSON:", e.message);
    console.log("First 500 chars:", String(data.flowData).substring(0, 500));
    process.exit(0);
  }
  console.log("\n=== FLOW DATA STRUCTURE ===");
  console.log("Keys:", Object.keys(fd));
  console.log("Nodes count:", fd.nodes ? fd.nodes.length : "N/A");
  console.log("Edges count:", fd.edges ? fd.edges.length : "N/A");

  if (fd.nodes) {
    console.log("\n=== NODE TYPES ===");
    const counts = {};
    fd.nodes.forEach((n) => {
      const label = (n.data && n.data.label) || n.type || "unknown";
      counts[label] = (counts[label] || 0) + 1;
    });
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => {
        console.log(`  ${k}: ${v}`);
      });
  }
} else {
  console.log("flowData is null/undefined/empty");
}
