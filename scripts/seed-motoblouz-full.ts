import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import {
  applyHumanDelay,
  coffeeBreak,
  crawlMotoblouzProductPage,
  discoverMotoblouzProductUrls,
  ingestMotoblouzRecord,
  type CrawlFailureReason,
} from "../lib/ingestion/motoblouz-master";

const LIMIT = 1000;
const BATCH_SIZE = 20;

function getRequiredEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Variable manquante: ${name}`);
  return val;
}

async function run(): Promise<void> {
  const supabase = createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  const urls = await discoverMotoblouzProductUrls(LIMIT);
  console.log(`[motoblouz-full] ${urls.length} URLs découvertes.`);

  const failed: Array<{ url: string; reason: CrawlFailureReason | string }> = [];
  let okCount = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    await applyHumanDelay();

    const crawled = await crawlMotoblouzProductPage(url);
    if (!crawled.ok) {
      failed.push({ url, reason: crawled.reason });
      console.log(
        `[motoblouz-full] [${i + 1}/${urls.length}] skip (${crawled.reason}): ${url}`
      );
    } else {
      try {
        await ingestMotoblouzRecord(supabase, crawled.record);
        okCount += 1;
        console.log(
          `[COMPARAISON] EAN: ${crawled.record.eanCode} | Modèle: ${crawled.record.model} | Prix: ${crawled.record.price}€ | Cat: ${crawled.record.category}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push({ url, reason: `ingest_error:${msg}` });
      }
    }

    if ((i + 1) % BATCH_SIZE === 0 && i + 1 < urls.length) {
      console.log("[motoblouz-full] Pause café 15s...");
      await coffeeBreak();
    }
  }

  if (failed.length > 0) {
    const content = failed.map((f) => `${f.reason}\t${f.url}`).join("\n");
    await writeFile("failed-urls.txt", content, "utf8");
  }

  const reasonCounts = new Map<string, number>();
  for (const f of failed) {
    reasonCounts.set(String(f.reason), (reasonCounts.get(String(f.reason)) ?? 0) + 1);
  }
  const summary = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  console.log(
    `[motoblouz-full] terminé. ok=${okCount}/${urls.length}, failed=${failed.length}${summary ? ` | ${summary}` : ""}`
  );
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[motoblouz-full] fatal: ${msg}`);
  process.exit(1);
});
