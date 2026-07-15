# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# zwave-service - Raspberry Pi Z-Wave controller (monorepo)

## Project Overview

An npm-workspaces monorepo containing a Fastify REST service that drives an Aeotec
Z-Stick 10 Pro Z-Wave controller via the [zwave-js](https://zwave-js.io) driver, plus
a React web client to manage it. The service provides device inclusion/exclusion,
device listing, on/off/dim control of switches and dimmers, and grouping of devices
into rooms and scenes. It ships as a **single Docker image** (the service serves both
the REST API and the web UI) designed to run on a Raspberry Pi 4 (Ubuntu 24.x, ARM64).

## Monorepo Layout

npm workspaces (`packages/*`), built in dependency order by the root scripts:

- **`packages/contracts`** (`@zwave-service/contracts`) — the single source of truth
  for API types (`src/zwaveTypes.ts`), imported by both the service and the web client.
- **`packages/service`** (`@zwave-service/service`) — the Fastify service (this is
  where all the prior `src/**` lives now).
- **`packages/web`** (`@zwave-service/web`) — Vite + React web client. Imports types
  from contracts (Vite aliases `@zwave-service/contracts` to its source).

Build tooling (`docker/`, `configs/imageConfig.json`, root `.scripts/dockerBuild.cjs`,
`eslint.config.mjs`) stays at the repo root.

## Architecture Overview

### Core Components (in `packages/service/src`)

1. **Fastify Server Composition** (`composeServer.ts`)
   - Config plugin registers first (provides `server.config`)
   - Services autoload from `services/` (provides `server.zwaveService` and `server.store`)
   - Routes autoload from `routes/`, prefixed with `/api/v1`
   - Web-client plugin registers last (serves the built SPA, see below)
   - `pluginTimeout` is 60s to allow for the Z-Wave driver start / controller interview

2. **Z-Wave Controller** (`services/zwaveController.ts`)
   - Plain class wrapping the `zwave-js` `Driver`
   - Loads or generates S2/S0 (and Long Range) security keys from `${zwaveStorage}/securityKeys.json`
   - Owns inclusion/exclusion, device discovery, and Binary/Multilevel Switch control
   - Maps device REST levels (0-100) to Z-Wave Multilevel Switch levels (0-99)

3. **Z-Wave Service** (`services/zwave.ts`)
   - `fastify-plugin` decorating `server.zwaveService`
   - Wraps the controller and returns the common `IServiceResponse` envelope
   - Registers an `onClose` hook to destroy the driver on shutdown

4. **Room/Scene Store** (`services/store.ts`)
   - `fastify-plugin` decorating `server.store`
   - Persists rooms and scenes as JSON in the storage volume (`rooms.json`, `scenes.json`)
   - Atomic writes (temp file + rename)

5. **Configuration** (`plugins/config.ts`)
   - `env-schema` over `./configs/${NODE_ENV}.env` + `process.env`
   - Ensures the storage directory exists; decorates `server.config`

6. **Web Client serving** (`plugins/webClient.ts`)
   - `@fastify/static` serves the built SPA from `webClientRoot` (default `/app/web`)
     at `/`, with a SPA fallback (non-API GETs return `index.html`; `/api/*` stays JSON)
   - Skipped if no `index.html` is found there, so local dev stays API-only while the
     web client runs from the Vite dev server

## Plugin Registration Flow

1. Config plugin (`server.config`)
2. Services via autoload (`server.zwaveService`, `server.store`) — ordered by `fastify-plugin` `dependencies`
3. Routes via autoload — declare service `dependencies` so they register after services

Helper classes (e.g. `zwaveController.ts`) use **named exports only** (no default
export) so `@fastify/autoload` skips them — only files whose default export is a
plugin are registered.

## Models & Schemas

- API types live in `packages/contracts/src/zwaveTypes.ts` (import-free so schema
  generation is clean). `packages/contracts/src/index.ts` re-exports them; both the
  service and the web client import from `@zwave-service/contracts`.
- `npm run build:schemas -w @zwave-service/service` generates a JSON schema per
  `export interface` **from the contracts types** into
  `packages/service/src/models/schemas/` using `ts-json-schema-generator`.
- `packages/service/src/models/index.ts` re-exports the contracts types and the
  local schemas. It **strips the top-level `$id`** from each schema so the same
  schema can be compiled inline on multiple routes without ajv reporting a duplicate id.
- **After changing `zwaveTypes.ts`, rebuild:** `npm run build:contracts` then
  `npm run build:service` (which regenerates schemas first). The root `npm run build`
  does the whole chain in order.

## Development Commands

```bash
npm install              # installs all workspaces
npm run build            # contracts -> schemas -> service -> web (dependency order)
npm run build:service    # contracts -> schemas -> service (skip web)
npm run build:web        # contracts -> web
npm run lint             # eslint over service + contracts (web excluded)
npm run clean            # clean all workspace build artifacts
npm run dev:service      # run the service locally (needs a Z-Stick)
npm run dev:web          # Vite dev server, proxies /api -> localhost:9094
npm run dockerbuild      # build (and push) the multi-arch image
```

## Configuration (env)

- `LOG_LEVEL` (default `debug`)
- `PORT` (default `9094`)
- `zwaveStorage` (default `/rpi-zwave/data`) — network cache, keys, rooms/scenes
- `zwaveSerialPort` (default `/dev/ttyACM0`)
- `webClientRoot` (default `/app/web`) — dir of the built SPA to serve; if it has no
  `index.html` the service runs API-only
- Optional key overrides: `ZWAVE_S0_LEGACY_KEY`, `ZWAVE_S2_UNAUTHENTICATED_KEY`,
  `ZWAVE_S2_AUTHENTICATED_KEY`, `ZWAVE_S2_ACCESS_CONTROL_KEY`,
  `ZWAVE_LR_S2_AUTHENTICATED_KEY`, `ZWAVE_LR_S2_ACCESS_CONTROL_KEY`

## API Endpoints

Prefix `/api/v1`. Envelope: `{ succeeded, statusCode, message, data? }`.

- `GET /health`
- `POST /inclusion/start` `{ strategy?, secure?, pin? }` (`secure: false` forces insecure/no-S2 inclusion, overriding `strategy`), `POST /inclusion/stop`
- `POST /exclusion/start`, `POST /exclusion/stop`
- `GET /devices`, `GET /devices/:nodeId`
- `POST /devices/:nodeId/control` `{ action: on|off|dim, level? }`
- `GET|POST /rooms`, `GET|PUT|DELETE /rooms/:roomId`, `POST /rooms/:roomId/control`
- `GET|POST /scenes`, `GET|PUT|DELETE /scenes/:sceneId`, `POST /scenes/:sceneId/activate`

## Hardware Requirements

- Aeotec Z-Stick 10 Pro on a serial port (default `/dev/ttyACM0`; prefer a stable
  `/dev/serial/by-id/...` path)
- Controllable Z-Wave switches (Binary Switch CC) and dimmers (Multilevel Switch CC)

## Docker Build System

- Single multi-stage, multi-arch build (`docker/Dockerfile`, `linux/amd64` +
  `linux/arm64`): build stage installs all workspaces and runs the root `build`
  (contracts → schemas → service → web) + `lint`; slim runtime copies the pruned
  `node_modules` (keeping the contracts workspace symlink), `packages/service/dist`
  + `configs`, `packages/contracts/dist`, and `packages/web/dist` → `/app/web`.
  Entrypoint is `packages/service/dist/index.js`. Uses the multi-arch
  `node:22-bookworm` base so buildx selects the right arch per platform.
- No compiler/python toolchain needed: the only native dep
  (`@serialport/bindings-cpp`, via zwave-js) installs a prebuilt N-API binary
  (`linux-x64` / `linux-arm64`) through `node-gyp-build`.
- Built/pushed via `.scripts/dockerBuild.cjs`, driven by `configs/imageConfig.json`.
  A multi-platform `arch` (comma-separated) triggers `--push` (no local `--load`)
  and requires a `docker-container` buildx builder.
- Image: `ghcr.io/sseiber/zwave-service`
- Runtime user `zwaveuser` is in the `dialout` group for serial access

## Important Implementation Details

- ES modules throughout (`"type": "module"`)
- Strict TypeScript with null checks
- `{ tags: [Name] }` structured logging; `exMessage()` for safe error strings
- The service fails fast if the Z-Wave driver cannot start (e.g. stick missing)
- Individual device operations throw until the controller interview completes
  (`server.zwaveService` guards on driver readiness)

## Deployment

- `setup/deployment/docker-compose.yml` passes the Z-Stick device through and
  mounts a named volume at `/rpi-zwave/data`
