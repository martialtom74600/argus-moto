export type GearCategory =
  | "casque"
  | "blouson"
  | "gants"
  | "bottes"
  | "pantalon";

const ACCESSORY_REGEXES: RegExp[] = [
  /\bvisiere\b/i,
  /\bvisière\b/i,
  /\becran\b/i,
  /\bécran\b/i,
  /\bpinlock\b/i,
  /\bmousses?\b/i,
  /\bplatines?\b/i,
  /\bintercom\b/i,
  /\bsliders?\b/i,
  /\bnettoyant\b/i,
  /\bpin'?s\b/i,
  /\bcasquette\b/i,
  /\bbonnet\b/i,
];

const CATEGORY_REGEXES: Array<{ category: GearCategory; rx: RegExp[] }> = [
  {
    category: "casque",
    rx: [
      /\bcasques?\b/i,
      /\bintegral\b/i,
      /\bintégral\b/i,
      /\bmodulable\b/i,
      /\bjet\b/i,
      /\bcross\b/i,
    ],
  },
  {
    category: "pantalon",
    rx: [/\bpantalons?\b/i],
  },
  {
    category: "blouson",
    rx: [/\bblousons?\b/i, /\bveste\b/i, /\bcuir\b/i, /\btextile\b/i, /\bcombinaison\b/i],
  },
  { category: "gants", rx: [/\bgants?\b/i] },
  { category: "bottes", rx: [/\bbottes?\b/i, /\bbaskets?\s+moto\b/i, /\bchaussures?\b/i] },
];

export function mapCategoryAndAccessory(tokens: string[]): {
  category: GearCategory | null;
  isAccessory: boolean;
} {
  const text = tokens.join(" ").toLowerCase();
  const isAccessory = ACCESSORY_REGEXES.some((rx) => rx.test(text));
  for (const entry of CATEGORY_REGEXES) {
    if (entry.rx.some((rx) => rx.test(text))) {
      return { category: entry.category, isAccessory };
    }
  }
  return { category: null, isAccessory };
}
