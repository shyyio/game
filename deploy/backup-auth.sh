#!/usr/bin/env bash
set -euo pipefail

DB=/home/app/data/auth/auth.sqlite3
NAME=auth.sqlite3
TMP="$(mktemp -d -p /home/app/data/auth)"
trap 'rm -rf "$TMP"' EXIT

sqlite3 "$DB" "VACUUM INTO '${TMP}/${NAME}'"
zstd -q "${TMP}/${NAME}"

rclone copyto "${TMP}/${NAME}.zst" "b2:spup-backups/$(hostname)/${NAME}.zst"
rclone copyto /home/app/data/auth/auth-signing-key.json "b2:spup-backups/$(hostname)/auth-signing-key.json"
rclone copyto /home/app/data/auth/auth-secret.json "b2:spup-backups/$(hostname)/auth-secret.json"
