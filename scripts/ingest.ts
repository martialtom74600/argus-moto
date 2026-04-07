import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DafyProvider } from "../lib/ingestion/providers/DafyProvider";
import { MotoblouzProvider } from "../lib/ingestion/providers/MotoblouzProvider";

function getArg(name: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg.split("=").slice(1).join("=");
}

function getRequiredEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Variable manquante: ${name}`);
  return val;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function run(): Promise<void> {
  const retailer = (getArg("retailer") ?? "").toLowerCase();
  const limitRaw = Number.parseInt(getArg("limit") ?? "100", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100;
  const verbose = hasFlag("verbose");

  const provider =
    retailer === "dafy"
      ? new DafyProvider()
      : retailer === "motoblouz"
        ? new MotoblouzProvider()
        : null;
  if (!provider) {
    throw new Error(
      "Usage: npx tsx scripts/ingest.ts --retailer=dafy|motoblouz --limit=100 [--verbose]"
    );
  }

  const supabase = createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  const result = await provider.ingest(supabase, limit, { verbose });
  if (result.failed.length > 0) {
    const content = result.failed.map((f) => `${f.reason}\t${f.url}`).join("\n");
    await writeFile("failed-urls.txt", content, "utf8");
    console.log(`[ingest] Détail échecs : ${path.join(process.cwd(), "failed-urls.txt")}`);
  }
  console.log(
    `[ingest] retailer=${retailer} terminé — insérés=${result.inserted}/${limit} échecs=${result.failed.length}`
  );
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ingest] fatal: ${msg}`);
  process.exit(1);
});
