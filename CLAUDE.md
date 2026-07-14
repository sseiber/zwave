# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# zwave-service - Raspberry Pi Z-Wave controller service

## Project Overview

zwave-service is a Node.js/TypeScript Fastify REST service that drives an Aeotec
Z-Stick 10 Pro Z-Wave controller via the [zwave-js](https://zwave-js.io) driver.
It provides device inclusion/exclusion, device listing, on/off/dim control of
switches and dimmers, and grouping of devices into rooms and scenes. It is
designed to run in Docker on a Raspberry Pi 4 (Ubuntu 24.x, ARM64).

## Architecture Overview

### Core Components

1. **Fastify Server Composition** (`src/composeServer.ts`)
   - Config plugin registers first (provides `server.config`)
   - Services autoload from `src/services` (provides `server.zwaveService` and `server.store`)
   - Routes autoload from `src/routes`, prefixed with `/api/v1`
   - `pluginTimeout` is 60s to allow for the Z-Wave driver start / controller interview

2. **Z-Wave Controller** (`src/services/zwaveController.ts`)
   - Plain class wrapping the `zwave-js` `Driver`
   - Loads or generates S2/S0 (and Long Range) security keys from `${zwaveStorage}/securityKeys.json`
   - Owns inclusion/exclusion, device discovery, and Binary/Multilevel Switch control
   - Maps device REST levels (0-100) to Z-Wave Multilevel Switch levels (0-99)

3. **Z-Wave Service** (`src/services/zwave.ts`)
   - `fastify-plugin` decorating `server.zwaveService`
   - Wraps the controller and returns the common `IServiceResponse` envelope
   - Registers an `onClose` hook to destroy the driver on shutdown

4. **Room/Scene Store** (`src/services/store.ts`)
   - `fastify-plugin` decorating `server.store`
   - Persists rooms and scenes as JSON in the storage volume (`rooms.json`, `scenes.json`)
   - Atomic writes (temp file + rename)

5. **Configuration** (`src/plugins/config.ts`)
   - `env-schema` over `./configs/${NODE_ENV}.env` + `process.env`
   - Ensures the storage directory exists; decorates `server.config`

## Plugin Registration Flow

1. Config plugin (`server.config`)
2. Services via autoload (`server.zwaveService`, `server.store`) — ordered by `fastify-plugin` `dependencies`
3. Routes via autoload — declare service `dependencies` so they register after services

Helper classes (e.g. `zwaveController.ts`) use **named exports only** (no default
export) so `@fastify/autoload` skips them — only files whose default export is a
plugin are registered.

## Models & Schemas

- TypeScript types live in `src/models/zwaveTypes.ts` (kept import-free so schema
  generation is clean).
- `npm run build:schemas` generates a JSON schema per `export interface` into
  `src/models/schemas/` using `ts-json-schema-generator`.
- `src/models/index.ts` re-exports the types and the schemas. It **strips the
  top-level `$id`** from each schema so the same schema can be compiled inline on
  multiple routes without ajv reporting a duplicate id.
- **Run `npm run build:schemas` after changing `zwaveTypes.ts`, before `npm run build`.**

## Development Commands

```bash
npm install
npm run lint
npm run build            # tsc build
npm run build:all        # force rebuild
npm run build:schemas    # regenerate JSON schemas from types
npm run clean            # clean build + generated files
npm run dockerbuild      # build (and push) the ARM64 Docker image
npm version [major|minor|patch]   # triggers docker build/push
```

## Configuration (env)

- `LOG_LEVEL` (default `debug`)
- `PORT` (default `9094`)
- `zwaveStorage` (default `/rpi-zwave/data`) — network cache, keys, rooms/scenes
- `zwaveSerialPort` (default `/dev/ttyACM0`)
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
  `linux/arm64`): Node build stage (installs deps, generates schemas, builds, lints)
  + slim runtime. Uses the multi-arch `node:22-bookworm` base so buildx selects the
  right arch per platform.
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
