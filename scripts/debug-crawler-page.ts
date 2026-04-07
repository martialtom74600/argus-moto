import { inspectProductUrl } from "../lib/pricing/internal-crawler";

function getArg(name: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg.split("=").slice(1).join("=");
}

async function run(): Promise<void> {
  const url = getArg("url");
  if (!url) {
    throw new Error("Usage: npx tsx scripts/debug-crawler-page.ts --url=https://...");
  }
  const retailer = getArg("retailer") ?? "Unknown";
  const brand = getArg("brand") ?? "";
  const model = getArg("model") ?? "";
  const modelQuery = [brand, model].filter(Boolean).join(" ").trim();
  const ean = getArg("ean");

  const result = await inspectProductUrl(url, retailer, modelQuery, ean);
  console.log(JSON.stringify(result, null, 2));
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[debug-crawler-page] ${msg}`);
  process.exit(1);
});
