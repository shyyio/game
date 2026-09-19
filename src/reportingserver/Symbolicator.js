import {existsSync, readdirSync, readFileSync} from "node:fs";
import path from "node:path";
import {SourceMapConsumer} from "source-map-js";

// Matches a V8 stack frame's trailing "source:line:column" (V8 columns are 1-based, source maps
// decode 0-based, hence the -1 in resolve()).
const FRAME_PATTERN = /^(\s*at\s+.*?)\(?([^\s()]+):(\d+):(\d+)\)?\s*$/;

/**
 * Resolves minified production stack traces against the .map files reportingserver's own
 * deploy build wrote to mapsDir/<buildVersion>/, per docs/architecture note: reportingserver
 * builds the client itself on deploy, so its own dist always matches whatever's live.
 */
export class Symbolicator {

    /**
     * @param {string} mapsDir
     */
    constructor(mapsDir) {
        this._mapsDir = mapsDir;
        // "<buildVersion>/<filename>" -> SourceMapConsumer
        this._consumersByKey = new Map();
    }

    /**
     * True once buildVersion's own folder of maps is on disk.
     * @param {string} buildVersion
     * @returns {boolean}
     */
    hasBuildMaps(buildVersion) {
        const buildDir = path.join(this._mapsDir, buildVersion);
        const mapsRoot = path.resolve(this._mapsDir) + path.sep;
        if (!path.resolve(buildDir).startsWith(mapsRoot)) {
            return false;
        }
        return existsSync(buildDir);
    }

    /**
     * Resolves every frame in stack it can find a matching map for; frames without a match pass
     * through unchanged.
     * @param {string} buildVersion
     * @param {string} stack
     * @returns {Promise<string|null>} null when not one frame resolved, so a stack is never cached
     *     as symbolicated before its maps land
     */
    async resolve(buildVersion, stack) {
        if (!this.hasBuildMaps(buildVersion)) {
            return null;
        }
        const buildDir = path.join(this._mapsDir, buildVersion);
        const lines = [];
        let isAnyResolved = false;
        for (const line of stack.split("\n")) {
            const resolved = this._resolveFrame(buildVersion, buildDir, line);
            if (resolved !== line) {
                isAnyResolved = true;
            }
            lines.push(resolved);
        }
        if (!isAnyResolved) {
            return null;
        }
        return lines.join("\n");
    }

    /**
     * @private
     * @param {string} buildVersion
     * @param {string} buildDir
     * @param {string} line
     * @returns {string}
     */
    _resolveFrame(buildVersion, buildDir, line) {
        const match = FRAME_PATTERN.exec(line);
        if (match === null) {
            return line;
        }
        const [, prefix, source, lineStr, columnStr] = match;
        const filename = source.split("/").pop().split("?")[0];
        const consumer = this._getConsumerByFilename(buildVersion, buildDir, filename);
        if (consumer === null) {
            return line;
        }
        const original = consumer.originalPositionFor({line: Number(lineStr), column: Number(columnStr) - 1});
        if (original.source === null) {
            return line;
        }
        const name = original.name || prefix.replace(/^\s*at\s+/, "").trim() || "<anonymous>";
        return `    at ${name} (${original.source}:${original.line}:${original.column})`;
    }

    /**
     * @private
     * @param {string} buildVersion
     * @param {string} buildDir
     * @param {string} filename
     * @returns {SourceMapConsumer|null}
     */
    _getConsumerByFilename(buildVersion, buildDir, filename) {
        const key = `${buildVersion}/${filename}`;
        const cached = this._consumersByKey.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const mapPath = this._getMapFileOrNull(buildDir, filename);
        if (mapPath === null) {
            this._consumersByKey.set(key, null);
            return null;
        }
        const consumer = new SourceMapConsumer(JSON.parse(readFileSync(mapPath, "utf8")));
        this._consumersByKey.set(key, consumer);
        return consumer;
    }

    /**
     * @private
     * @param {string} buildDir
     * @param {string} filename
     * @returns {string|null}
     */
    _getMapFileOrNull(buildDir, filename) {
        const direct = path.join(buildDir, `${filename}.map`);
        if (existsSync(direct)) {
            return direct;
        }
        for (const entry of readdirSync(buildDir, {recursive: true})) {
            if (path.basename(entry) === `${filename}.map`) {
                return path.join(buildDir, entry);
            }
        }
        return null;
    }
}
