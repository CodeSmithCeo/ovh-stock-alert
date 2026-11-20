# ovh-stock-alert

GitHub Actions check (every 20 min on paper, GitHub delivers far fewer) and a laptop timer every 5 min, of OVH **VPS-2** (Linux) stock in EU datacentres (Frankfurt, Warsaw, Strasbourg, Gravelines, Roubaix, Milan).
Also Hetzner Cloud **CX23 / CAX11 / CX33** (Germany/Finland): the public page https://www.hetzner.com/cloud/cost-optimized/ marks a sold-out plan "not available". Per plan, not per location.

When stock appears, a push notification goes to the ntfy topic in the `NTFY_TOPIC` secret (urgent, tap opens the order page). When it sells out again, a low-priority note.

- State (per source, what was in stock last run): `state.json`, committed by the workflow.
- Test the phone: Actions → check → Run workflow → tick "test".
- Stop: Actions → check → Disable workflow (or delete the repo once the server is ordered).
- Source: public OVH API, no login: `https://eu.api.ovh.com/v1/vps/order/rule/datacenter?ovhSubsidiary=IE&planCode=vps-2027-model2`

## Laptop timer

GitHub's free-tier schedule drops most slots (4 runs in 24 h on 19./20.11.), and OVH stock can sell out within hours, so the laptop checks too, every 5 min while it is on.

- Units: `laptop/ovh-stock-alert.service` + `.timer` (systemd user). Set-up commands are at the top of the `.service` file. `WorkingDirectory` must point at the checkout.
- Topic: `~/.config/ovh-stock-alert/ntfy-topic` (600). State: `~/.local/state/ovh-stock-alert/state.json`, separate from the repo's `state.json`.
- Both runners push on their own, so a restock can arrive twice (laptop first, GitHub later).
- Log: `journalctl --user -u ovh-stock-alert -n 20`. Stop: `systemctl --user disable --now ovh-stock-alert.timer`.
