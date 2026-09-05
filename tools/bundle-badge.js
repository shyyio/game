// Measures the shipped client bundle and writes its gzipped size into the README badge.
//
//   node tools/bundle-badge.js
//
// `npm run build` runs it last. The client bundle carries the base mods compiled in, so its size is
// the whole game's download.

import {readdirSync, readFileSync, writeFileSync} from "node:fs";
import {gzipSync} from "node:zlib";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = join(ROOT, "build/client");
const README = join(ROOT, "README.md");
const BYTES_PER_KB = 1024;

// The line this script owns, matched so a rerun replaces it rather than stacking badges.
const BADGE_LINE = /^!\[bundle size\]\(https:\/\/img\.shields\.io\/badge\/[^\n]*\)$/m;

/**
 * Sums every file under `dir`, each gzipped on its own the way it is served.
 * @param {string} dir
 * @returns {number}
 */
export function gzippedSize(dir) {
    let total = 0;
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            total += gzippedSize(path);
            continue;
        }
        total += gzipSync(readFileSync(path), {level: 9}).length;
    }
    return total;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function badgeMarkdown(bytes) {
    const kb = Math.round(bytes / BYTES_PER_KB);
    return `![bundle size](https://img.shields.io/badge/client%20+%20base%20mods-${kb}%20KB%20gzip-blue)`;
}

/**
 * @param {string} readme
 * @param {string} badge
 * @returns {string}
 */
export function withBadge(readme, badge) {
    if (BADGE_LINE.test(readme)) {
        return readme.replace(BADGE_LINE, badge);
    }
    const lines = readme.split("\n");
    lines.splice(1, 0, "", badge);
    return lines.join("\n");
}

const bytes = gzippedSize(CLIENT_DIR);
writeFileSync(README, withBadge(readFileSync(README, "utf8"), badgeMarkdown(bytes)));
console.log(`bundle badge: ${Math.round(bytes / BYTES_PER_KB)} KB gzip`);
