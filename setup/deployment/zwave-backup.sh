#!/usr/bin/env bash
#
# Live backup of the zwave-service data volume (rooms/scenes, security keys, and the
# Z-Wave network cache). Runs against the container WITHOUT stopping it, so scheduled
# scenes keep firing — see setup/deployment/README.md section 8.
#
# Backs up "through" the container (--volumes-from) rather than naming the volume, so
# it is immune to the Compose project-name prefix (zwave_zwave-data vs zwave-data).
#
# Usage:  ./zwave-backup.sh [destination-dir]
# Env:    BACKUP_DIR   destination (default /home/$USER/zwave-backups, or $1)
#         KEEP         how many backups to retain (default 8)
#         CONTAINER    container name (default zwave-service)
#
set -euo pipefail

# cron runs with a minimal PATH; be explicit so `docker` is found
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

CONTAINER="${CONTAINER:-zwave-service}"
BACKUP_DIR="${1:-${BACKUP_DIR:-$HOME/zwave-backups}}"
KEEP="${KEEP:-8}"
DATA_PATH=/rpi-zwave/data

stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log()   { echo "$(stamp) [zwave-backup] $*"; }
die()   { log "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found in PATH"

# --volumes-from needs the container to exist; it may be running or stopped
docker inspect "$CONTAINER" >/dev/null 2>&1 \
    || die "container '$CONTAINER' not found (is the stack deployed?)"

mkdir -p "$BACKUP_DIR" || die "cannot create $BACKUP_DIR"

ARCHIVE="$BACKUP_DIR/zwave-data-$(date +%F-%H%M%S).tgz"
TMP="$ARCHIVE.partial"

log "backing up $CONTAINER:$DATA_PATH -> $ARCHIVE"

# Write to .partial first and rename only on success, so an interrupted run never
# leaves a truncated archive that looks like a good backup.
if ! docker run --rm \
        --volumes-from "$CONTAINER" \
        -v "$BACKUP_DIR":/backup \
        alpine \
        tar czf "/backup/$(basename "$TMP")" -C "$DATA_PATH" . ; then
    rm -f "$TMP"
    die "tar failed; no archive written"
fi

# Sanity-check the archive before trusting it: securityKeys.json is the file that
# actually matters, and its absence means we backed up the wrong (or an empty) volume.
if ! tar tzf "$TMP" | grep -q 'securityKeys.json'; then
    rm -f "$TMP"
    die "archive did not contain securityKeys.json - refusing to keep it"
fi

mv "$TMP" "$ARCHIVE"
log "wrote $(du -h "$ARCHIVE" | cut -f1) $ARCHIVE"

# Retention: keep the newest $KEEP archives, delete the rest
if [ "$KEEP" -gt 0 ]; then
    # shellcheck disable=SC2012  # filenames are timestamped and shell-safe
    ls -1t "$BACKUP_DIR"/zwave-data-*.tgz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
        log "pruning $old"
        rm -f "$old"
    done
fi

log "done"
