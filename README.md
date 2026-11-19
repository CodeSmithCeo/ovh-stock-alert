# ovh-stock-alert

Hourly GitHub Actions check of OVH **VPS-2** (Linux) stock in EU datacentres (Frankfurt, Warsaw, Strasbourg, Gravelines, Roubaix, Milan).
Also Hetzner Cloud **CX23 / CAX11 / CX33** in Falkenstein, Nuremberg and Helsinki, via the Hetzner Cloud API with a read-only token in the `HCLOUD_TOKEN` secret (skipped while the secret is missing). The Hetzner website can't be used: its "currently unavailable" note sits on every plan's button.

When stock appears, a push notification goes to the ntfy topic in the `NTFY_TOPIC` secret (urgent, tap opens the order page). When it sells out again, a low-priority note.

- State (per source, what was in stock last run): `state.json`, committed by the workflow.
- Test the phone: Actions → check → Run workflow → tick "test".
- Stop: Actions → check → Disable workflow (or delete the repo once the server is ordered).
- Source: public OVH API, no login: `https://eu.api.ovh.com/v1/vps/order/rule/datacenter?ovhSubsidiary=IE&planCode=vps-2027-model2`
