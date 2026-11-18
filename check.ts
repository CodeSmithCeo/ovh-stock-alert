// Checks OVH VPS stock in EU datacentres and pushes a phone alert (ntfy) when it changes.
// Runs on GitHub Actions. Node 24 runs .ts directly (type stripping), no dependencies.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PLAN = "vps-2027-model2"; // VPS-2: 4 vCPU / 8 GB / 75 GB
const ORDER_URL = `https://www.ovhcloud.com/en-ie/vps/configurator/?planCode=${PLAN}`;
const EU: Record<string, string> = {
  "eu-west-lim": "Frankfurt",
  "eu-central-waw": "Warsaw",
  "eu-west-sbg": "Strasbourg",
  "eu-west-gra": "Gravelines",
  "eu-west-rbx": "Roubaix",
  "eu-south-mil": "Milan",
};
const STATE_FILE = "state.json";

type Dc = { code: string; linuxStatus: string };

const topic = process.env.NTFY_TOPIC;
if (!topic) throw new Error("NTFY_TOPIC secret missing");

async function push(title: string, body: string, priority: string, click?: string): Promise<void> {
  const headers: Record<string, string> = { Title: title, Priority: priority, Tags: "computer" };
  if (click) headers.Click = click;
  const res = await fetch(`https://ntfy.sh/${topic}`, { method: "POST", body, headers });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

if (process.argv.includes("--test")) {
  await push("OVH stock alert: test", "If you see this, alerts work.", "default", ORDER_URL);
  console.log("test sent");
  process.exit(0);
}

const res = await fetch(
  `https://eu.api.ovh.com/v1/vps/order/rule/datacenter?ovhSubsidiary=IE&planCode=${PLAN}`,
);
if (!res.ok) throw new Error(`OVH API ${res.status}`);
const { datacenters } = (await res.json()) as { datacenters: Dc[] };

const inStock = datacenters
  .filter((d) => d.code in EU && d.linuxStatus === "available")
  .map((d) => EU[d.code])
  .sort();
const before: string[] = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : [];

const added = inStock.filter((c) => !before.includes(c));
console.log(`in stock (Linux, EU): ${inStock.join(", ") || "none"} | before: ${before.join(", ") || "none"}`);

if (added.length) {
  await push(
    `OVH VPS-2 IN STOCK: ${added.join(", ")}`,
    `Linux VPS-2 orderable now in ${inStock.join(", ")}. Order 12 months, Ubuntu 24.04. Tap to open the order page.`,
    "urgent",
    ORDER_URL,
  );
} else if (before.length && !inStock.length) {
  await push("OVH VPS-2 sold out again", "No EU datacentre has Linux VPS-2 any more.", "low");
}

if (JSON.stringify(before) !== JSON.stringify(inStock)) {
  writeFileSync(STATE_FILE, JSON.stringify(inStock) + "\n");
  console.log("state changed");
}
