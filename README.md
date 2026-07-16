# Z-Wave controller (monorepo)

An npm-workspaces monorepo: a Fastify REST service that drives an
[Aeotec Z-Stick 10 Pro](https://aeotec.com/) Z-Wave controller, plus a React web
client to manage it. The service includes/excludes devices, lists them, sends
on/off/dim commands to switches and dimmers, and groups devices into rooms and
scenes. It ships as a **single Docker image** (the service serves both the REST API
and the web UI), designed to run on a Raspberry Pi 4 (Ubuntu 24.x, ARM64).

## Workspaces

| Package | Name | Purpose |
| ------- | ---- | ------- |
| `packages/contracts` | `@zwave-service/contracts` | Shared API types (source of truth), imported by the service and the web client |
| `packages/service` | `@zwave-service/service` | Fastify service (REST API + serves the web build) |
| `packages/web` | `@zwave-service/web` | Vite + React web client |

## Dependencies

- Node.js >= 20
- npm
- Docker (for building/running the distributable image)
- An Aeotec Z-Stick 10 Pro on a serial port (default `/dev/ttyACM0`)

## Install & build

```bash
npm install              # installs all workspaces
npm run build            # contracts -> schemas -> service -> web (dependency order)
```

## Local development

Run the service (needs a Z-Stick) and the web client's Vite dev server side by side:

```bash
npm run dev:service      # Fastify on :9094 (API only in dev)
npm run dev:web          # Vite dev server; proxies /api -> localhost:9094
```

Service config comes from `packages/service/configs/${NODE_ENV}.env` and/or
environment variables (see [Configuration](#configuration)). A `development.env` is
provided.

- **lint:** `npm run lint` (service + contracts)
- **build service only:** `npm run build:service` (regenerates schemas first)
- **regenerate schemas:** `npm run build:schemas -w @zwave-service/service`
  (after editing `packages/contracts/src/zwaveTypes.ts`)

## Configuration

| Variable          | Default             | Description                                            |
| ----------------- | ------------------- | ------------------------------------------------------ |
| `LOG_LEVEL`       | `debug`             | Pino log level                                         |
| `PORT`            | `9094`              | HTTP listen port                                       |
| `zwaveStorage`    | `/rpi-zwave/data`   | Directory for the network cache, security keys, and rooms/scenes JSON |
| `zwaveSerialPort` | `/dev/ttyACM0`      | Serial device path for the Z-Stick                     |
| `webClientRoot`   | `/app/web`          | Directory of the built SPA to serve; API-only if it has no `index.html` |

Security (S2/S0) keys are generated on first run and saved to
`${zwaveStorage}/securityKeys.json`. They may be overridden with the env vars
`ZWAVE_S0_LEGACY_KEY`, `ZWAVE_S2_UNAUTHENTICATED_KEY`, `ZWAVE_S2_AUTHENTICATED_KEY`,
`ZWAVE_S2_ACCESS_CONTROL_KEY`, `ZWAVE_LR_S2_AUTHENTICATED_KEY`,
`ZWAVE_LR_S2_ACCESS_CONTROL_KEY` (each a 32-char hex string).

## Web UI

In the deployed image the service serves the React web client at the root URL —
open `http://<host>:9094/` (e.g. `http://zwave:9094/`). The API lives under `/api/v1`.

Three tabs:

- **Devices** — live device state, on/off/dim control, and insecure inclusion.
- **Rooms** — create/edit rooms (name + device picker), all-on/all-off per room, delete.
- **Scenes** — create/edit scenes (name, room, trigger, and per-device action:
  on/off/dim level), plus **Activate** to test a scene immediately.

## API

All routes are prefixed with `/api/v1`. Responses use a common envelope:
`{ succeeded, statusCode, message, data? }`.

### Inclusion / Exclusion

| Method | Route                | Body                                  |
| ------ | -------------------- | ------------------------------------- |
| POST   | `/inclusion/start`   | `{ "strategy"?, "secure"?, "pin"? }`  |
| POST   | `/inclusion/stop`    | –                                     |
| POST   | `/exclusion/start`   | –                                     |
| POST   | `/exclusion/stop`    | –                                     |

- `secure` (boolean) — set `false` to include the device **without any security
  (no S2/S0)**. This is the simple choice for switches/dimmers in a trusted
  environment. It overrides `strategy` when set to `false`. Example:
  `{ "secure": false }`.
- `strategy` — one of `default` (negotiates the best security the device
  supports), `insecure`, `s2`, `s0`. `{ "secure": false }` is equivalent to
  `{ "strategy": "insecure" }`.
- `pin` — the 5-digit DSK from the device label, required only for authenticated
  S2 inclusion.

After calling `start`, activate inclusion/exclusion on the physical device.

### Devices

| Method | Route                      | Body                              |
| ------ | -------------------------- | --------------------------------- |
| GET    | `/devices`                 | list all included devices + state |
| GET    | `/devices/:nodeId`         | one device                        |
| POST   | `/devices/:nodeId/control` | `{ "action": "on"\|"off"\|"dim", "level"? }` |

`level` is `0-100` and required for `dim` (dimmers only).

### Rooms (a named group of devices)

| Method | Route                    | Body                                   |
| ------ | ------------------------ | -------------------------------------- |
| GET    | `/rooms`                 | list                                   |
| POST   | `/rooms`                 | `{ "name", "deviceIds": number[] }`    |
| GET    | `/rooms/:roomId`         | one room                               |
| PUT    | `/rooms/:roomId`         | `{ "name"?, "deviceIds"? }`            |
| DELETE | `/rooms/:roomId`         | delete                                 |
| POST   | `/rooms/:roomId/control` | `{ "action", "level"? }` applied to all devices in the room |

### Scenes (a named set of device actions, belonging to a room)

| Method | Route                      | Body                                                                              |
| ------ | -------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/scenes`                  | list                                                                              |
| POST   | `/scenes`                  | `{ "name", "roomId", "trigger", "devices": [{ "deviceId", "action", "level"? }] }` |
| GET    | `/scenes/:sceneId`         | one scene                                                                         |
| PUT    | `/scenes/:sceneId`         | `{ "name"?, "roomId"?, "trigger"?, "devices"? }`                                   |
| DELETE | `/scenes/:sceneId`         | delete                                                                            |
| POST   | `/scenes/:sceneId/activate`| apply each participating device's action                                          |

- `roomId` — the room the scene belongs to (required).
- `trigger` — `manual` (activate on demand) or `scheduled`. **Scheduling is not
  implemented yet**: a `scheduled` scene is stored as such but only runs when
  activated manually.
- `devices[].action` — `on` | `off` | `dim`. `level` (0-100) is required for `dim`
  and applies to dimmers only.

### Health

`GET /health` → `Healthy`

## Docker

The distributable is a multi-stage, **multi-arch** image (`linux/amd64` +
`linux/arm64`) built from `docker/Dockerfile` and published to
`ghcr.io/sseiber/zwave-service` (see `configs/imageConfig.json`). The Raspberry Pi 4
pulls the arm64 variant automatically.

```bash
npm run dockerbuild     # build and push the multi-arch image
```

A multi-platform build must be pushed directly to the registry (it can't be loaded
into the local image store) and requires a container-driver buildx builder — create
one once:

```bash
docker buildx create --name zwavemulti --driver docker-container --bootstrap --use
```

To build a single-arch image locally instead (e.g. natively on the Pi), point at
the same Dockerfile:

```bash
docker build -f docker/Dockerfile -t zwave-service:local .
```

Deploy on the Pi with `setup/deployment/docker-compose.yml`, which passes the
Z-Stick device through and mounts a volume for `/rpi-zwave/data`:

```bash
docker compose -f setup/deployment/docker-compose.yml up -d
```

> The container runs as a non-root user in the `dialout` group. Make sure the
> serial device passed through (`/dev/ttyACM0` or a `/dev/serial/by-id/...` path)
> is owned by group `dialout` on the host.

For a full walkthrough of provisioning a dedicated Raspberry Pi 4 (OS/storage
choices, headless flash, Z-Stick placement and udev rule, autostart, and volume
backup), see [setup/deployment/README.md](setup/deployment/README.md).
