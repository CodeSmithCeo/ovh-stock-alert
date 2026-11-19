// Checks server stock and pushes a phone alert (ntfy) when it changes:
//   OVH VPS-2 (Linux) in EU datacentres: public API, no login.
//   Hetzner Cloud CX23 / CAX11 / CX33 in EU locations: Hetzner Cloud API, read-only token in the HCLOUD_TOKEN
//   secret (skipped with a log line while the secret is missing). The website can't tell: its "currently
//   unavailable" note is on every plan's button, available or not.
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
const HZ_TYPES = ["cx23", "cax11", "cx33"]; // 2/4 GB, 2/4 GB ARM, 4/8 GB
const HZ_EU: Record<string, string> = { fsn1: "Falkenstein", nbg1: "Nuremberg", hel1: "Helsinki" };
const hetzner: Source = {
  key: "hetzner",
  name: "Hetzner",
  orderUrl: "https://console.hetzner.com/",
  hint: "CX23 is enough for the dashboard alone, hourly billing.",
  async inStock() {
    const token = process.env.HCLOUD_TOKEN;
    if (!token) { console.log("hetzner: HCLOUD_TOKEN secret missing, skipped"); return undefined; }
    const get = async <T>(path: string): Promise<T> => {
      const res = await fetch(`https://api.hetzner.cloud/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Hetzner API ${path} ${res.status}`);
      return (await res.json()) as T;
    };
    const { server_types } = await get<{ server_types: { id: number; name: string }[] }>("server_types?per_page=50");
    const nameOf = new Map(server_types.map((t) => [t.id, t.name]));
    const { datacenters } = await get<{ datacenters: { location: { name: string }; server_types: { available: number[] } }[] }>("datacenters");
    const out = new Set<string>();
    for (const dc of datacenters) {
      const city = HZ_EU[dc.location.name];
      if (!city) continue;
      for (const id of dc.server_types.available) {
        const n = nameOf.get(id);
        if (n && HZ_TYPES.includes(n)) out.add(`${n.toUpperCase()} ${city}`);
      }
    }
    return [...out];
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
