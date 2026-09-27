/**
 * Render a saved receipt document HTML to PDF with the same pipeline the API
 * uses — handy for inspecting layout changes without hitting a running server.
 *
 *   npx tsx scripts/render-html.ts <input.html> <output.pdf>
 */
import fs from "node:fs";
import path from "node:path";
import { htmlToPdf } from "../src/lib/pdf";

async function main(): Promise<void> {
  const input = process.argv[2];
  const output = process.argv[3] ?? input?.replace(/\.html$/i, ".pdf");
  if (!input || !output) {
    console.error("Usage: npx tsx scripts/render-html.ts <input.html> <output.pdf>");
    process.exit(1);
  }

  const html = fs.readFileSync(path.resolve(input), "utf8");
  const buffer = await htmlToPdf(html);
  fs.writeFileSync(path.resolve(output), buffer);
  console.log(`wrote ${output} (${buffer.length} bytes)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
