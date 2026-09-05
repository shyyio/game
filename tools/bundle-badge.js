// Measures a shipped bundle and writes its size into the matching README badge.
//
//   node tools/bundle-badge.js client
//   node tools/bundle-badge.js server
//
// `npm run build` and `npm run build:server` each run it last for their own bundle. The client
// bundle carries the base mods compiled in, so its gzipped size is the whole game's download; the
// server bundle is the operator's, measured raw and with the native addons excluded since they
// install from npm.

import {readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {gzipSync} from "node:zlib";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const README = join(ROOT, "README.md");
const BYTES_PER_KB = 1024;

/**
 * One badge: the build directory it measures, the alt text that identifies its line in the README,
 * and the text shields.io draws on its left half.
 */
class Badge {

    /**
     * @param {string} dir - relative to the repo root
     * @param {string} alt
     * @param {string} label
     * @param {boolean} gzip - measure it compressed, the way a browser downloads it
     */
    constructor(dir, alt, label, gzip) {
        this.dir = join(ROOT, dir);
        this.alt = alt;
        this.label = label;
        this.gzip = gzip;
    }

    /**
     * The line this badge owns, matched so a rerun replaces it rather than stacking badges.
     * @returns {RegExp}
     */
    get line() {
        return new RegExp(`^!\\[${this.alt}\\]\\(https://img\\.shields\\.io/badge/[^\\n]*\\)$`, "m");
    }

    /**
     * @param {number} bytes
     * @returns {string}
     */
    markdown(bytes) {
        const kb = Math.round(bytes / BYTES_PER_KB);
        const size = this.gzip ? `${kb}%20KB%20gzip` : `${kb}%20KB`;
        return `![${this.alt}](https://img.shields.io/badge/${this.label.replace(/ /g, "%20")}-${size}-blue)`;
    }
}

/** @type {Object<string, Badge>} */
export const BADGES = {
    client: new Badge("build/client", "bundle size", "client + base mods", true),
    server: new Badge("build/server", "server size", "server", false),
};

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
 * Sums every file under `dir` as it sits on disk.
 * @param {string} dir
 * @returns {number}
 */
export function rawSize(dir) {
    let total = 0;
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            total += rawSize(path);
            continue;
        }
        total += statSync(path).size;
    }
    return total;
}

/**
 * @param {string} readme
 * @param {Badge} badge
 * @param {string} markdown
 * @returns {string}
 */
export function withBadge(readme, badge, markdown) {
    if (badge.line.test(readme)) {
        return readme.replace(badge.line, markdown);
    }
    const lines = readme.split("\n");
    lines.splice(1, 0, "", markdown);
    return lines.join("\n");
}

const name = process.argv[2];
const badge = BADGES[name];
if (badge === undefined) {
    throw new Error(`unknown badge "${name}": pass one of ${Object.keys(BADGES).join(", ")}`);
}
const bytes = badge.gzip ? gzippedSize(badge.dir) : rawSize(badge.dir);
const unit = badge.gzip ? "KB gzip" : "KB";
writeFileSync(README, withBadge(readFileSync(README, "utf8"), badge, badge.markdown(bytes)));
console.log(`${name} badge: ${Math.round(bytes / BYTES_PER_KB)} ${unit}`);
