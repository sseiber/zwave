# Web UI — architecture plan (decision pending)

Planning notes for adding a web interface to manage the zwave-service. **No code
written yet** — this captures the options discussion so it survives across sessions.

## The question

How to structure a web client for managing this service:

1. Include the web client code inside this project.
2. Create a separate stand-alone companion project.
3. Turn this project into a monorepo hosting both.

## Recommendation: option 3 (monorepo), shipped as one Docker image

For a single-appliance controller on a dedicated Pi, optimize for **one deployable
artifact served same-origin**, while reusing the API's typed contracts.

### Reasoning by what matters on a Pi appliance

- **Ops / deployment (favors 1 or 3).** The Pi runs one container today. If Fastify
  serves the web bundle itself (static SPA at `/`, API at `/api/v1`), it stays **one
  container, same origin → no CORS, no second artifact, no reverse proxy**. Both
  option 1 and a well-structured monorepo deliver this. Option 2 means two deploy
  artifacts + CORS or an nginx — more moving parts for no benefit on one box.
- **Contract sharing (favors 3).** The service already generates JSON schemas from
  its TS types (`src/models`). A shared `contracts` package lets the web client
  import the exact request/response types and schemas the API validates against, so
  they can't drift. Ongoing payoff for a typed client.
- **Effort (favors 1).** Option 1 is least setup (a `web/` app + `@fastify/static`).
  A monorepo adds npm workspaces + build orchestration; if the UI is a few pages that
  overhead may not pay off yet.
- **Precedent.** CarPort-PLC used a separate SPA (`service-carport-spa.yaml`) — the
  two-container / independent-deploy model. Fine, but for this dedicated Pi a single
  artifact is simpler.

### When each option wins

- **1** — start today, small UI, fine with the frontend toolchain in the API repo.
- **3** — client reuses API types, UI expected to grow; still ships as one image.
- **2** — UI will live elsewhere (different host, cloud dashboard, or managing
  *multiple* controllers) and needs its own lifecycle.

## Concrete shape for option 3

npm workspaces:

```
packages/
  service/     # the current Fastify app (moved here)
  web/         # Vite + React/Svelte/Vue — keep it light for a browser on a LAN
  contracts/   # shared TS types + generated JSON schemas, imported by both
```

- The Docker build gains a **web-build stage**; its static output is copied into the
  runtime image and served by the service via `@fastify/static` (SPA at `/`, API
  stays at `/api/v1`).
- Moderate refactor: the Docker build, `tsconfig`, and the schema-gen script paths
  (`.scripts/buildTypeSchemas.cjs`) all shift into the workspace layout. Nothing
  risky, but touches several files.

## Suggested first UI scope

Start tiny, then grow:

1. Device list with live on/off/level state (`GET /api/v1/devices`).
2. On / off / dim controls per device (`POST /api/v1/devices/:nodeId/control`).
3. Inclusion / exclusion buttons (with the `{ "secure": false }` option surfaced).
4. Rooms management + room control.
5. Scenes management + activate.

## Fallback: option 1 (fast path)

If staying minimal: add a `web/` folder (Vite app), build it in the Dockerfile, serve
it with `@fastify/static`. Can graduate to workspaces (option 3) later.

## Status

- Decision **not yet made**; awaiting user's pick among 1 / 3 (2 deprioritized).
- Next action when resumed: confirm the choice, then scaffold — for option 3,
  restructure into workspaces, move the service into `packages/service`, extract
  `packages/contracts`, and wire Fastify to serve a starter SPA.
