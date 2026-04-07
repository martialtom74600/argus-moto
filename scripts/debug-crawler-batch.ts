import { mkdir, writeFile } from "node:fs/promises";
import { inspectProductUrl } from "../lib/pricing/internal-crawler";
import { discoverMotoblouzProductUrls } from "../lib/ingestion/motoblouz-master";

function getArg(name: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg.split("=").slice(1).join("=");
}

function parseXmlTagValues(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gims");
  for (const m of xml.matchAll(rx)) {
    const v = (m[1] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

async function discoverDafyUrls(limit: number): Promise<string[]> {
  const res = await fetch("https://www.dafy-moto.com/sitemap-produits.xml", {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      referer: "https://www.google.com/",
    },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  return parseXmlTagValues(xml, "loc").slice(0, limit);
}

async function run(): Promise<void> {
  const retailer = (getArg("retailer") ?? "motoblouz").toLowerCase();
  const limitRaw = Number.parseInt(getArg("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

  const urls =
    retailer === "dafy"
      ? await discoverDafyUrls(limit)
      : await discoverMotoblouzProductUrls(limit);

  await mkdir("logs", { recursive: true });
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `logs/inspection-${retailer}-${now}.jsonl`;

  const lines: string[] = [];
  const reasonCounts = new Map<string, number>();
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const result = await inspectProductUrl(
      url,
      retailer === "dafy" ? "Dafy" : "Motoblouz"
    );
    lines.push(JSON.stringify(result));
    const key = result.skippedReason ?? "accepted";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    console.log(
      `[inspect] [${i + 1}/${urls.length}] ${key} | cat=${result.detectedCategory ?? "null"} | blocks=${result.jsonLdBlockCount}`
    );
  }

  await writeFile(outPath, `${lines.join("\n")}\n`, "utf8");
  const summary = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
  console.log(`[inspect] file=${outPath}`);
  console.log(`[inspect] summary ${summary}`);
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[debug-crawler-batch] ${msg}`);
  process.exit(1);
});
