#!/usr/bin/env bash
set -euo pipefail

DB=/home/app/data/auth.sqlite3
NAME=auth.sqlite3
TMP="$(mktemp -d -p /home/app/data)"
trap 'rm -rf "$TMP"' EXIT

sqlite3 "$DB" "VACUUM INTO '${TMP}/${NAME}'"
zstd -q "${TMP}/${NAME}"

rclone copyto "${TMP}/${NAME}.zst" "b2:spup-backups/$(hostname)/${NAME}.zst"
rclone copyto /home/app/data/auth-signing-key.json "b2:spup-backups/$(hostname)/auth-signing-key.json"
rclone copyto /home/app/data/auth-secret.json "b2:spup-backups/$(hostname)/auth-secret.json"
