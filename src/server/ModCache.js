// The server's content-addressed store of packaged mod files. Every file is re-hashed before it is
// written and again on demand, and is stored under its own digest — a mismatch anywhere refuses to
// boot rather than running code the lockfile does not pin.

import {createHash} from "node:crypto";
import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {formatIntegrity, integrityHex, contentName} from "@/common/ModIntegrity.js";
import {ModManifest, SDK_VERSION} from "@/common/ModManifest.js";
import {ModLockEntry, MANIFEST_FILE} from "@/common/ModLockfile.js";

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex sha-256
 */
export function sha256Hex(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Downloads one package file. `file:` URLs and plain paths read from disk, so a local build can be
 * pinned and tested without a server.
 * @param {string} url
 * @returns {Promise<Uint8Array>}
 */
export async function fetchPackageFile(url) {
    if (url.startsWith("file:")) {
        return await readFile(fileURLToPath(url));
    }
    if (!url.includes("://")) {
        return await readFile(url);
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

/**
 * Fetches a package and pins the hash of every file it declares, for the CLI to write into the
 * lockfile.
 * @param {string} url the mod's base URL
 * @param {function(string): Promise<Uint8Array>} [fetchFile]
 * @returns {Promise<ModLockEntry>}
 */
export async function resolvePackage(url, fetchFile = fetchPackageFile) {
    const baseUrl = url.endsWith("/") ? url : `${url}/`;
    const manifestBytes = await fetchFile(`${baseUrl}${MANIFEST_FILE}`);
    const manifest = ModManifest.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
    if (manifest.sdkVersion !== SDK_VERSION) {
        throw new Error(
            `${manifest.name} ${manifest.version} is built for SDK version ${manifest.sdkVersion}; ` +
            `this server speaks ${SDK_VERSION}`,
        );
    }
    const integrity = new Map([[MANIFEST_FILE, formatIntegrity(sha256Hex(manifestBytes))]]);
    for (const file of manifest.files) {
        const bytes = await fetchFile(`${baseUrl}${file}`);
        integrity.set(file, formatIntegrity(sha256Hex(bytes)));
    }
    return new ModLockEntry(baseUrl, manifest.name, manifest.version, integrity);
}

export class ModCache {

    /**
     * @param {string} dir
     * @param {function(string): Promise<Uint8Array>} [fetchFile] injected for tests
     */
    constructor(
        dir,
        fetchFile = fetchPackageFile,
    ) {
        this._dir = dir;
        this._fetchFile = fetchFile;
    }

    /**
     * The path a content-addressed name is stored at.
     * @param {string} name as returned by contentName()
     * @returns {string}
     */
    pathOf(name) {
        return join(this._dir, name);
    }

    /**
     * Reads a cached file, re-hashing it: a cache entry that no longer matches its own name has
     * been tampered with or corrupted.
     * @param {string} name
     * @returns {Uint8Array}
     */
    read(name) {
        const bytes = readFileSync(this.pathOf(name));
        const hex = sha256Hex(bytes);
        if (!name.startsWith(hex)) {
            throw new Error(`Cached file ${name} does not match its own hash`);
        }
        return bytes;
    }

    /**
     * Fills the cache from the lockfile, fetching only what is missing and refusing any file whose
     * hash differs from its pin.
     * @param {ModLockfile} lockfile
     * @returns {Promise<number>} how many files were downloaded
     */
    async populate(lockfile) {
        mkdirSync(this._dir, {recursive: true});
        let downloaded = 0;
        for (const entry of lockfile.mods) {
            for (const [file, integrity] of entry.integrity) {
                const name = contentName(integrityHex(integrity), file);
                if (existsSync(this.pathOf(name))) {
                    continue;
                }
                const bytes = await this._fetchFile(`${entry.url}${file}`);
                const hex = sha256Hex(bytes);
                if (formatIntegrity(hex) !== integrity) {
                    throw new Error(
                        `${entry.url}${file} hashes to ${formatIntegrity(hex)}, but "${entry.name}" pins ${integrity}`,
                    );
                }
                writeFileSync(this.pathOf(name), bytes);
                downloaded += 1;
            }
        }
        return downloaded;
    }

    /**
     * Re-hashes every pinned file already in the cache.
     * @param {ModLockfile} lockfile
     * @returns {string[]} the problems found, empty when the cache is intact
     */
    verify(lockfile) {
        const problems = [];
        for (const entry of lockfile.mods) {
            for (const [file, integrity] of entry.integrity) {
                const name = contentName(integrityHex(integrity), file);
                if (!existsSync(this.pathOf(name))) {
                    problems.push(`${entry.name}: ${file} is not cached`);
                    continue;
                }
                const hex = sha256Hex(readFileSync(this.pathOf(name)));
                if (formatIntegrity(hex) !== integrity) {
                    problems.push(`${entry.name}: ${file} hashes to ${formatIntegrity(hex)}, pinned ${integrity}`);
                }
            }
        }
        return problems;
    }

    /**
     * The parsed manifest of a pinned mod.
     * @param {ModLockEntry} entry
     * @returns {object} the raw mod.json payload
     */
    manifestJson(entry) {
        const name = contentName(integrityHex(entry.integrityOf(MANIFEST_FILE)), MANIFEST_FILE);
        return JSON.parse(new TextDecoder().decode(this.read(name)));
    }
}
