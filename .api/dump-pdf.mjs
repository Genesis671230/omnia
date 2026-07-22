import { extractText, getDocumentProxy } from "unpdf";
import { readFileSync, writeFileSync } from "fs";
const buf = readFileSync("/Users/gaian/Downloads/Transaction history_16_07_2026.pdf");
const pdf = await getDocumentProxy(new Uint8Array(buf));
const { text } = await extractText(pdf, { mergePages: true });
writeFileSync(".api/pdf-text.txt", text);
console.log("chars:", text.length, "lines:", text.split(/\r?\n/).length);
