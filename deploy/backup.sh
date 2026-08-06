#!/usr/bin/env bash
set -euo pipefail

DB=/home/app/data/game/world.sqlite3
NAME=world.sqlite3
TMP="$(mktemp -d -p /home/app/data/game)"
trap 'rm -rf "$TMP"' EXIT

sqlite3 "$DB" "VACUUM INTO '${TMP}/${NAME}'"
zstd -q "${TMP}/${NAME}"

rclone copyto "${TMP}/${NAME}.zst" "b2:spup-backups/$(hostname)/${NAME}.zst"