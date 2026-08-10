# Roadmap — richer device state, scheduler run times, dashboard

> **This document is the design record for the FIRST batch (Features 1–3).** They and
> several later phases have all shipped — see the running list below. The current
> forward-looking item is **[Next phase — switch-triggered scenes](#next-phase--switch-triggered-scenes)** at the bottom.

**Shipped since (current version 1.11.0, deployed to the Pi with real devices):**

| Ver | What |
|---|---|
| 1.4.0 | F1 — richer device state (Meter/statistics/security/firmware/battery) + health-check |
| 1.5.0 | F2 — scheduler next/last run times, `GET /scenes/status`, persisted `sceneRuns.json` |
| 1.6.0 | F3 — Dashboard tab (default) |
| 1.7.0 / 1.7.1 | Device rename (`node.name`); "#N" → "node N" label |
| 1.8.0 | Scenes span all devices; `roomId` is an optional label |
| 1.9.0 | No manual/scheduled mode — every scene is manual-activatable + carries a **list** of schedules |
| 1.10.0 | Device configuration parameters (Configuration CC) in device Details |
| 1.11.0 | Mesh maintenance — re-interview (`node.refreshInfo`) + route rebuild |

Plus a tested live-backup script (`setup/deployment/zwave-backup.sh`) and its SIGPIPE
fix. Build/deploy/git conventions are in [CLAUDE.md](../CLAUDE.md); the web UI lives in
`packages/web`, the service in `packages/service`, shared types in `packages/contracts`.
The original Features 1–3 design record is kept below for reference.

## Target hardware (affects capability-gating)

The user's devices will be a mix of **Leviton Z-Wave 800-series**, **Z-Wave Plus**,
and **first-generation (non-Plus) Z-Wave**. Capabilities differ sharply:

- **First-gen**: older CC versions; likely **no Meter CC** (no energy reporting),
  sparse statistics/RSSI, S0-or-insecure only, weaker mesh participation. These are
  the likely "weak links" that make mesh-health worthwhile.
- **Z-Wave Plus**: more CCs, better reporting.
- **800-series**: newest — likely metering, S2, good statistics/RSSI.

Everything below is **capability-gated**: read a value only if the node supports it,
and render `—` otherwise. Expect first-gen devices to show fewer fields.

---

## Feature 1 — Richer device state (all except multi-endpoint)

Additive, non-breaking: extend `IDeviceInfo` with optional fields populated in
`ZWaveController.describeNode` (`packages/service/src/services/zwaveController.ts`).

### Contracts (`packages/contracts/src/zwaveTypes.ts`)

```ts
export interface IDevicePower {   // Meter CC (electric)
    watts?: number; kWh?: number; volts?: number; amps?: number;
}
export interface IDeviceLink {    // node.statistics + node.lastSeen
    lastSeen?: string;            // ISO
    rtt?: number;                 // ms
    rssi?: number;                // dBm (from the last working route)
    hops?: number;                // repeaters in the route (0 = direct)
}
// Add to IDeviceInfo (all optional):
//   targetLevel?, securityClass?, firmwareVersion?,
//   power?: IDevicePower, link?: IDeviceLink,
//   battery?: { level?: number; isLow?: boolean }   // for future sensors/locks
```

### Service — where each field comes from in zwave-js

- **power** — `node.getValue({ commandClass: CommandClasses.Meter, property: 'value', propertyKey })`.
  Meter propertyKeys encode rate-type + scale; use the CC value helpers to find the
  W / kWh / V / A values. Gate on `node.supportsCC(CommandClasses.Meter)`.
- **link** — `node.statistics` (`rtt`, `lwr`/`nlwr` route stats incl. `rssi` and
  repeater list → `hops`) and `node.lastSeen`. NOTE: passive RSSI/route stats may be
  undefined until traffic flows; see mesh-health note below.
- **targetLevel** — Multilevel Switch `targetValue` (differs from `currentValue`
  while ramping → show "dimming to X%").
- **securityClass** — `node.getHighestSecurityClass()` (relevant: insecure inclusion
  means `None`).
- **firmwareVersion** — `node.firmwareVersion`.
- **battery** — `Battery` CC (`level`, `isLow`); harmless to include now, real value
  arrives with sensors/locks.

### Mesh/link health — the diagnostic win

The user specifically wants this for diagnosing the mesh (ties back to the USB-2.0 /
extension-cable interference guidance in the deployment README). Two options:

1. **Passive**: read `node.statistics` as it accumulates. Cheap, but RSSI/route can be
   empty until the node has exchanged traffic.
2. **Active**: a per-device "Test link" action calling `node.checkLifelineHealth()`,
   which returns rating + RSSI + latency. Better data, but it generates traffic — make
   it on-demand, not polled.

Recommend shipping passive stats in `describeNode`, plus an on-demand
`POST /devices/:nodeId/health-check` (→ `checkLifelineHealth`) for a real reading.

### Web

- **Device detail view** (modal or route) using the existing `GET /devices/:nodeId`.
  Keep the Devices list lean; put the deep state here. Add a small power badge to the
  list row when `power.watts` is present.

---

## Feature 2 — Scheduler next/last run times in the UI

The scheduler (`packages/service/src/services/scheduler.ts`) already computes next-run
times in memory (`getPlan()`), and logs them. Surface them, and add last-run.

### Service

- Track **lastRun** (and lastResult: succeeded + message) per scene. Persist lastRun on
  the scene so "past runs" survive a restart — add e.g. `store.recordSceneRun(sceneId,
  when, result)` writing to `scenes.json`; keep `nextRun` computed fresh (never
  persisted, since it depends on "now").
- Expose status. Cleanest: a `GET /scenes/status` returning
  `[{ sceneId, nextRun?, lastRun?, lastResult? }]`, or fold `nextRun`/`lastRun` into the
  `GET /scenes` response by having the route ask the scheduler. Prefer a dedicated
  status endpoint so `IScene` stays a pure stored shape.

### Web

- Show "Next: …, Last: …" on scene cards, and feed the dashboard's upcoming/recent
  lists. `packages/web/src/schedule.ts` already has `describeSchedule` for the rule
  text; add relative-time formatting for the run timestamps.

---

## Feature 3 — Dashboard view

A new **Dashboard** tab, made the default/first tab, composing existing + new data.
No new API beyond Features 1–2.

Suggested cards:

- **Devices at a glance** — counts (total / on / offline), and a **total power draw**
  (sum of `power.watts` where present).
- **Mesh health** — devices sorted by signal / last-seen, flagging `dead` or weak
  nodes (the first-gen devices are the ones to watch). This is the headline diagnostic.
- **Rooms** — quick all-on/all-off per room (reuse `controlRoom`).
- **Schedule** — upcoming scheduled scenes (next run) and recent runs (last run),
  from Feature 2.

Implementation: a `DashboardPanel` in `packages/web/src/panels/`, reading the shared
device/room/scene state already held in `App.tsx`, plus the new scheduler-status fetch.

---

## Suggested sequencing (2 PRs)

1. **PR A — service enrichment**: contracts fields + `describeNode` rich state +
   `health-check` endpoint + scheduler last-run persistence + `/scenes/status`
   endpoint. Ship + verify (unit-test any new math; smoke-test the endpoints).
2. **PR B — web**: Dashboard tab (default), device detail view, scene run-times on
   cards. Ship.

Each follows the established flow: branch → build/lint/verify → bump version →
multi-arch build+push (needs the `zwavemulti` builder + GHCR login) → PR → rebase
merge. Bump to **1.4.0** (A) and **1.5.0** (B), or ship both under one minor if done
together.

## Open decisions to confirm when starting

- **Passive vs active mesh health** (recommend: passive stats + on-demand health-check).
- **Metering refresh**: rely on cached values the device reports, or add a per-device
  poll that actively `Meter.get()`s? (Recommend cached first; active refresh later.)
- **Run-time persistence**: persist `lastRun` in `scenes.json` (survives restart) vs
  in-memory only (simpler). Recommend persist.

---

# Next phase — switch-triggered scenes

**Not started.** The next feature: pressing a physical wall switch activates a scene.
Example the user gave — pressing the switch at the top of the basement stairs should
activate the "basement" scene (turning on a set of basement lights across rooms).
Double-activating a light the scene shares with the trigger switch is acceptable.

### Mechanism
- When a switch is physically pressed, the device **reports its new state** to the
  controller, and zwave-js emits an event. `wireNodeEvents` in
  [`services/zwaveController.ts`](../packages/service/src/services/zwaveController.ts)
  currently handles only `ready`/`dead` — extend it to listen for **value updates** on
  Binary/Multilevel Switch `currentValue`. On a matching transition, activate the bound
  scene via `zwaveService.applyScene`.
- Works with any plain switch/dimmer. A richer option for supported devices is
  **Central Scene CC** (double-tap/triple-tap/hold gestures) — lets you bind a gesture
  without the normal press changing the trigger's own load. Start with plain
  `currentValue`; Central Scene can be a follow-up.

### Data model
- A trigger binding, e.g. `{ deviceId, when: 'on' | 'off', sceneId }`. Persist it —
  likely a new `triggers.json` in the store (kept off `IScene`, the same way
  `sceneRuns.json` is), so the stored scene stays a pure user shape.

### ⚠️ Feedback-loop guard (design in from the start)
If a scene sets a device that is **also** a trigger, a naive listener re-fires forever
(scene turns switch on → switch reports on → triggers scene again → …). Prevent with a
combination of:
- trigger only on a genuine **off→on rising edge** (ignore repeats of the same state);
- **ignore reports briefly after the service itself commanded** that device (so a
  scene's own `applyScene` writes don't re-enter the trigger);
- optionally, don't let a scene re-trigger from a device that scene just set.

### Open decisions to confirm when starting
- **On-only vs on+off** triggers.
- **Where bindings live** — separate `triggers.json` store (recommended) vs on the scene.
- **UI placement** — a "Triggers" section in the scene editor ("activate when device X
  turns on") vs a device-side "when pressed, run scene Y".
- **Central Scene gestures** in v1 or deferred.

Follows the established flow: branch → build/lint/verify (Fastify `inject` for the
service; esbuild + `renderToStaticMarkup` for web, exporting pure helpers to test) →
bump minor (next: **1.12.0**) + deployment README image tag → PR → rebase-merge →
multi-arch build/push (`zwavemulti`).
