// Checks server stock and pushes a phone alert (ntfy) when it changes:
//   OVH VPS-2 (Linux) in EU datacentres: public API, no login.
//   Hetzner Cloud CX23 / CAX11 / CX33: the public plan page (its "not available" label), no login.
// Runs on GitHub Actions. Node 24 runs .ts directly (type stripping), no dependencies.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const STATE_FILE = "state.json";
type State = Record<string, string[]>; // source -> what was in stock last run

const topic = process.env.NTFY_TOPIC;
if (!topic) throw new Error("NTFY_TOPIC secret missing");

async function push(title: string, body: string, priority: string, click?: string): Promise<void> {
  const headers: Record<string, string> = { Title: title, Priority: priority, Tags: "computer" };
  if (click) headers.Click = click;
  const res = await fetch(`https://ntfy.sh/${topic}`, { method: "POST", body, headers });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

interface Source {
  key: string;
  name: string; // in the phone message
  orderUrl: string;
  hint: string; // what to order
  inStock(): Promise<string[] | undefined>; // undefined = not checked this run
}

// --- OVH VPS-2 -------------------------------------------------------------------------------------------
const OVH_PLAN = "vps-2027-model2"; // VPS-2: 4 vCPU / 8 GB / 75 GB
const OVH_EU: Record<string, string> = {
  "eu-west-lim": "Frankfurt",
  "eu-central-waw": "Warsaw",
  "eu-west-sbg": "Strasbourg",
  "eu-west-gra": "Gravelines",
  "eu-west-rbx": "Roubaix",
  "eu-south-mil": "Milan",
};
const ovh: Source = {
  key: "ovh",
  name: "OVH VPS-2",
  orderUrl: `https://www.ovhcloud.com/en-ie/vps/configurator/?planCode=${OVH_PLAN}`,
  hint: "Order 12 months, Ubuntu 24.04.",
  async inStock() {
    const res = await fetch(`https://eu.api.ovh.com/v1/vps/order/rule/datacenter?ovhSubsidiary=IE&planCode=${OVH_PLAN}`);
    if (!res.ok) throw new Error(`OVH API ${res.status}`);
    const { datacenters } = (await res.json()) as { datacenters: { code: string; linuxStatus: string }[] };
    return datacenters.filter((d) => d.code in OVH_EU && d.linuxStatus === "available").map((d) => OVH_EU[d.code]);
  },
};

// --- Hetzner Cloud CX23 / CAX11 / CX33 ---------------------------------------------------------------
// The plan page marks a sold-out plan with a "not available" label (class product-highlight-label-NotAvailable)
// in its row, and greys its Create button. Per plan, not per location. No login needed.
const HZ_TYPES = ["cx23", "cax11", "cx33"]; // 2/4 GB, 2/4 GB ARM, 4/8 GB
const HZ_PAGE = "https://www.hetzner.com/cloud/cost-optimized/";
const hetzner: Source = {
  key: "hetzner",
  name: "Hetzner",
  orderUrl: HZ_PAGE,
  hint: "CX23 is enough for the dashboard alone, hourly billing.",
  async inStock() {
    const res = await fetch(HZ_PAGE, { headers: { "User-Agent": "Mozilla/5.0 (stock-alert)" } });
    if (!res.ok) throw new Error(`Hetzner page ${res.status}`);
    const html = await res.text();
    // Each plan row ends with its Create button (configbtn ... type=<plan>); the label sits earlier in the row.
    const rows = html.split(/class="[^"]*configbtn[^"]*"/);
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const type = rows[i].match(/type=(\w+)/)?.[1];
      if (!type || seen.has(type)) continue;
      seen.add(type);
      if (HZ_TYPES.includes(type) && !rows[i - 1].slice(-20000).includes("product-highlight-label-NotAvailable")) out.push(type.toUpperCase());
    }
    const missing = HZ_TYPES.filter((t) => !seen.has(t));
    if (missing.length) throw new Error(`Hetzner page changed, plans not found: ${missing.join(", ")}`);
    return out;
  },
};

const SOURCES = [ovh, hetzner];

if (process.argv.includes("--test")) {
  await push("Server stock alert: test", "If you see this, alerts work.", "default", ovh.orderUrl);
  console.log("test sent");
  process.exit(0);
}

const raw: unknown = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const before: State = Array.isArray(raw) ? { ovh: raw as string[] } : (raw as State); // old format: OVH only
const after: State = { ...before };

for (const s of SOURCES) {
  const now = (await s.inStock())?.sort();
  if (!now) continue;
  const was = before[s.key] ?? [];
  console.log(`${s.key}: in stock ${now.join(", ") || "none"} | before ${was.join(", ") || "none"}`);
  const added = now.filter((x) => !was.includes(x));
  if (added.length) {
    await push(`${s.name} IN STOCK: ${added.join(", ")}`, `Orderable now: ${now.join(", ")}. ${s.hint} Tap to open.`, "urgent", s.orderUrl);
  } else if (was.length && !now.length) {
    await push(`${s.name} sold out again`, `Nothing of it in stock in the EU any more.`, "low");
  }
  after[s.key] = now;
}

if (JSON.stringify(before) !== JSON.stringify(after) || Array.isArray(raw)) {
  writeFileSync(STATE_FILE, JSON.stringify(after) + "\n");
  console.log("state changed");
}
