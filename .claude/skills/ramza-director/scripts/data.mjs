/* Write <dir>/data.js (window.RULES, window.FACTS) so a template never types a number.
 *   node data.mjs <templateDir> */
import fs from "node:fs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../../../..");
const dir = process.argv[2] ?? path.resolve(HERE, "../templates/3d");
const R = fs.readFileSync(`${REPO}/config/rules.json`, "utf8");
const F = fs.readFileSync(`${REPO}/.claude/skills/ramza-social/templates/facts.json`, "utf8");
fs.writeFileSync(`${dir}/data.js`, `window.RULES = ${R.trim()};\nwindow.FACTS = ${F.trim()};\n`);
console.log("wrote", `${dir}/data.js`);
