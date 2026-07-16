# Deploying zwave-service on a Raspberry Pi 4

Provisioning guide for a dedicated Raspberry Pi 4 running the Z-Wave controller
service as an always-on appliance. Targets Ubuntu Server 24.04 LTS (ARM64) with
Docker; the published image `ghcr.io/sseiber/zwave-service` is multi-arch, so the
Pi pulls the `linux/arm64` variant automatically.

The [`docker-compose.yml`](./docker-compose.yml) in this directory is the deployment
descriptor referenced below.

## 1. Storage & OS

- **Boot from a USB SSD, not an SD card.** This is a 24/7 writer (network cache,
  logs); SD cards wear out and corrupt — the most common cause of a dead Pi
  appliance. A small USB3 SSD is cheap insurance. High-endurance SD is the fallback.
- **OS: Ubuntu Server 24.04 LTS — ARM64 (aarch64).** The Pi 4 is ARM hardware, so
  it needs the arm64 build, *not* amd64 (both are "64-bit", but the architectures
  are incompatible). In Raspberry Pi Imager the "(64-bit)" entry listed under the Pi
  is already the arm64 image; if you download from ubuntu.com instead, pick the
  arm64 / "Raspberry Pi" image, not the amd64/PC one. Memory cgroups are enabled by
  default (no `cmdline.txt` edits, unlike Raspberry Pi OS). Raspberry Pi OS Lite
  64-bit is a fine alternative.
- **Use wired Ethernet.** Don't put an always-on controller on Wi-Fi.

## 2. Flash it headless

Use **Raspberry Pi Imager** → Ubuntu Server 24.04 LTS (64-bit) → click the gear
(⚙️) to pre-configure before writing:

- hostname `zwave`
- enable SSH with your **public key** (not a password)
- username, locale, timezone

## 3. First-boot baseline

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades          # automatic security patches
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Give the Pi a DHCP reservation on your router (stable IP), or set a static one.

# Minimal firewall
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 9094/tcp                           # the service
sudo ufw enable
```

## 4. Install Docker (official repo, not snap)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER                     # log out/in afterward
sudo systemctl enable --now docker
```

## 5. Provision the Z-Stick

Two physical best practices that materially affect mesh reliability:

- **Use a USB 2.0 port and a short USB extension cable** to move the stick a few
  inches from the Pi. The Pi 4's USB 3.0 ports and board emit RF noise in the
  900 MHz band that degrades Z-Wave range — this is the single most common
  "why is my mesh flaky" fix.
- **Find the device path — it varies by stick.** Run:

```bash
ls -l /dev/serial/by-id/
```

  Some controllers appear as a single `/dev/ttyACM0` (CDC-ACM). Others — including
  Z-Sticks built on a Silicon Labs CP210x bridge — appear as one or two
  `/dev/ttyUSB*` ports. A **dual-UART CP2105 exposes two interfaces** (`-if00-port0`
  and `-if01-port0`); only one is the Z-Wave radio. Example output from such a stick:

```
usb-Silicon_Labs_CP2105_Dual_USB_to_UART_Bridge_Controller_0160AF28-if00-port0 -> ../../ttyUSB0
usb-Silicon_Labs_CP2105_Dual_USB_to_UART_Bridge_Controller_0160AF28-if01-port0 -> ../../ttyUSB1
```

- **Use the `by-id` path directly** in the compose `devices:` mapping (step 6). It's
  stable across reboots and, for dual-port sticks, unambiguous because it encodes the
  interface — simpler and more robust than a udev rule. No udev setup required.

- **Dual-port sticks — which interface is the Z-Wave radio.** On the **Aeotec
  Z-Stick 10 Pro (CP2105)** the Z-Wave Serial API is on **`-if01-port0`** (confirmed
  working); `if00` is the other UART and only produces a `Timeout while waiting for
  an ACK from the controller (ZW0200)` during the controller interview. If your stick
  differs, pick empirically: bring the service up (steps 6–7) and watch
  `docker logs -f zwave-service` — `Driver ready - home id: ...` means you chose the
  Z-Wave port; a `ZW0200` timeout (it takes ~20s to fire) means try the other
  interface and restart.

<details>
<summary>Optional: a fixed <code>/dev/zwave</code> symlink via udev</summary>

Only needed if you prefer a short, chip-independent path. For a dual-port CP210x you
**must** disambiguate by interface number, or the rule matches both ports (identical
vendor/product/serial). Read your actual values first:

```bash
udevadm info -q property -n /dev/ttyUSB1 | grep -E 'ID_VENDOR_ID|ID_MODEL_ID|ID_USB_INTERFACE_NUM'
# then, substituting your values (CP2105 is typically 10c4:ea70; the Z-Stick 10 Pro's
# Z-Wave radio is interface 01):
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea70", ENV{ID_USB_INTERFACE_NUM}=="01", SYMLINK+="zwave", GROUP="dialout", MODE="0660"' \
  | sudo tee /etc/udev/rules.d/99-zwave.rules
sudo udevadm control --reload && sudo udevadm trigger
ls -l /dev/zwave
```
</details>

## 6. Deploy with Compose

Copy [`docker-compose.yml`](./docker-compose.yml) to the Pi (e.g. `~/zwave/`). Pin the
image to a version tag rather than `:latest`, and set the `devices:` mapping to the
path from step 5. A tuned service block:

```yaml
services:
  zwave-service:
    image: ghcr.io/sseiber/zwave-service:1.5.0     # pin the version
    container_name: zwave-service
    restart: unless-stopped
    devices:
      # Map the host by-id path (from step 5) to a fixed name inside the container.
      # Z-Stick 10 Pro: the Z-Wave radio is the -if01-port0 interface (if00 times out).
      # Single-port sticks: use the /dev/serial/by-id/...ttyACM0 symlink instead.
      - /dev/serial/by-id/usb-Silicon_Labs_CP2105_Dual_USB_to_UART_Bridge_Controller_0160AF28-if01-port0:/dev/zwave
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - zwaveSerialPort=/dev/zwave
      - zwaveStorage=/rpi-zwave/data
      # Scheduled scenes run on local wall-clock time - without TZ the container is UTC
      - TZ=America/Los_Angeles
      # Only needed for sunrise/sunset schedules
      # - zwaveLatitude=47.6062
      # - zwaveLongitude=-122.3321
    volumes:
      - zwave-data:/rpi-zwave/data
    ports:
      - "9094:9094"
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }   # cap log growth
volumes:
  zwave-data:
    driver: local
```

```bash
cd ~/zwave
docker login ghcr.io -u sseiber                     # only if the package is private
docker compose up -d
```

`restart: unless-stopped` plus the enabled Docker service means the container
returns after every reboot and power loss.

> **Build on the Pi instead** (optional): copy the repo over and
> `docker build -f docker/Dockerfile -t zwave-service:local .` (native arm64, no
> emulation), then point the compose `image:` at `zwave-service:local`.

## 7. Verify

```bash
curl http://localhost:9094/health                   # -> Healthy
docker logs -f zwave-service                         # wait for "Driver ready - home id: ..."

# Include a switch/dimmer without S2 (trusted environment):
curl -X POST http://localhost:9094/api/v1/inclusion/start \
     -H 'content-type: application/json' -d '{"secure":false}'
#    ...activate inclusion on the device now...
curl http://localhost:9094/api/v1/devices            # new node appears
```

Then open the **web UI** in a browser at `http://<pi-host>:9094/` (e.g.
`http://zwave:9094/`) — Devices (live state, on/off/dim, inclusion), Rooms, and
Scenes (including schedules).

> **Scheduling:** scheduled scenes fire on the container's local time, so set `TZ`
> above. Sunrise/sunset schedules additionally need `zwaveLatitude`/`zwaveLongitude`;
> without them the API rejects those schedules. On startup the scheduler logs the
> timezone and location it resolved, and logs each scene's next run time.

## 8. Back up the volume (the important one)

The `zwave-data` volume holds `securityKeys.json`, the Z-Wave network cache, and
your rooms/scenes. **If you lose it, you lose the pairing to every device and must
re-include them all.** Snapshot it periodically and copy it off-box:

```bash
docker run --rm -v zwave-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/zwave-data-$(date +%F).tgz -C /data .
```

A weekly cron job is plenty. To restore, extract the tarball back into a fresh
`zwave-data` volume before starting the container.

## Operational notes

- **Updates:** `docker compose pull && docker compose up -d` to move to a new image
  tag. Pin tags so updates are deliberate.
- **Time sync** (`systemd-timesyncd`, on by default) matters for logs and TLS.
- **Interference:** keep the controller reasonably central to the mesh; the USB
  extension cable from step 5 is the highest-impact placement fix.
