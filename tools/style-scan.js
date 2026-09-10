// Line scan of src/ for the mechanical CLAUDE.md style rules. Every hit under a strict rule fails
// the run; the review rules only print, since their hits need a reader's judgment.
//
//   node tools/style-scan.js [--review]

import {readdirSync, readFileSync, statSync} from "node:fs";
import {join, relative, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["src", "tools"];

class StyleRule {

    /**
     * @param {string} name
     * @param {RegExp} pattern
     * @param {string} message
     * @param {boolean} strict
     */
    constructor(name, pattern, message, strict) {
        this.name = name;
        this.pattern = pattern;
        this.message = message;
        this.strict = strict;
    }
}

const RULES = [
    new StyleRule("enum-trailer", /\{number\}[^@]*\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)*_\*/, "type the constant family with a @typedef", true),
    new StyleRule("call-in-ternary", /=\s[^?"'`]*\?\s[^:"'`]*\w\([^:]*\)\s*:|=\s[^?"'`]*\?\s[^:"'`]*:\s*\w[\w.]*\(/, "a call in a ternary branch means if/else", true),
    new StyleRule("snake-field", /name: "[a-z0-9]+_[a-z0-9_]+"|^\s+"?[a-z0-9]+_[a-z0-9_]+"? (TEXT|INTEGER|REAL|BLOB)\b/, "record fields and columns are camelCase", true),
    new StyleRule("nullish", /^\s*(?![/*]).*\?\?=?/, "no nullish coalescing", true),
    new StyleRule("spread-args", /\w\(\.\.\.|,\s*\.\.\.\w+\s*\)/, "no spread in argument lists", false),
    new StyleRule("inline-if", /^\s*(if|else if|for|while) \(.*\) [^{\s].*;\s*$/, "every conditional gets braces", true),
    new StyleRule("observed-vocab", /\b(?!PerformanceObserver)\w*([oO]bserv|(?<![sS])[wW]atch)\w*\b/, "chunk visibility is subscribe/isSubscribed", true),
    new StyleRule("record-noun", /\b\w*Record(?!ing|s\b)\w*\b|\b[A-Z_]*_RECORD\b/, "a table element is an Entry", true),
    new StyleRule("ensure-verb", /\b_?ensure\w*\(/, "get-or-create is getOr<Verb>By<Key>", true),
    new StyleRule("return-literal", /^\s*return \{\s*\w/, "a multi-value result is a named class", true),
    new StyleRule("contrast-comment", /^\s*(\/\/|\*).*\b(no longer|instead of|rather than|would (bypass|be|have)|isn't|is not a|not a )\b/, "state the present fact only", false),
    new StyleRule("subjectless-bool", /^\s{4}(static )?_?(is|has|can|should)[A-Z][a-z]*\(/, "a boolean names its subject", false),
];

const GLOSSARY_VERBS = new Set([
    "create", "destroy", "attach", "detach", "transfer", "drain", "set", "clear", "push", "pop",
    "shift", "delete", "build", "rebuild", "connect", "disconnect", "add", "remove", "acquire",
    "release", "insert", "put", "get", "advance", "tick", "place", "spawn", "despawn", "emit",
    "publish", "send", "dispatch", "notify", "register", "unregister", "generate", "subscribe",
    "unsubscribe", "is", "has", "can", "should",
]);

const ENGINE_HOOKS = new Set([
    "constructor", "submitIntents", "postResolve", "chunkSync", "onSpawn", "onDespawn",
    "onChunkChanged", "dispatchMessage", "inspect", "serialize", "rebuild", "getPinnedPortEids",
    "isPlacementAllowed",
]);

const METHOD_LINE = /^\s{4}(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(_?[a-z]\w*)\s*\([^)]*\)\s*\{$/;
const LEADING_WORD = /^_?([a-z]+)/;

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function listSourceFiles(dir, out) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            listSourceFiles(path, out);
        } else if ((name.endsWith(".js") || name.endsWith(".vue")) && name !== "style-scan.js") {
            out.push(path);
        }
    }
    return out;
}

class ScanResult {

    /**
     * @param {Map<string, Hit[]>} hitsByRule
     * @param {Map<string, Hit[]>} verbs
     */
    constructor(hitsByRule, verbs) {
        this.hitsByRule = hitsByRule;
        this.verbs = verbs;
    }
}

class Hit {

    /**
     * @param {string} file
     * @param {number} line
     * @param {string} text
     */
    constructor(file, line, text) {
        this.file = file;
        this.line = line;
        this.text = text;
    }
}

/**
 * @param {string[]} files
 * @returns {ScanResult}
 */
export function scanFiles(files) {
    const hitsByRule = new Map(RULES.map(rule => [rule.name, []]));
    const verbs = new Map();
    for (const file of files) {
        const relativePath = relative(ROOT, file);
        const lines = readFileSync(file, "utf8").split("\n");
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            for (const rule of RULES) {
                if (rule.pattern.test(line)) {
                    hitsByRule.get(rule.name).push(new Hit(relativePath, index + 1, line.trim()));
                }
            }
            const method = line.match(METHOD_LINE);
            if (method === null || ENGINE_HOOKS.has(method[1])) {
                continue;
            }
            const verb = method[1].match(LEADING_WORD)[1];
            if (GLOSSARY_VERBS.has(verb)) {
                continue;
            }
            if (!verbs.has(verb)) {
                verbs.set(verb, []);
            }
            verbs.get(verb).push(new Hit(relativePath, index + 1, method[1]));
        }
    }
    return new ScanResult(hitsByRule, verbs);
}

function main() {
    const review = process.argv.includes("--review");
    const files = SCAN_ROOTS.flatMap(root => listSourceFiles(join(ROOT, root), []));
    const {hitsByRule, verbs} = scanFiles(files);
    let failed = false;
    for (const rule of RULES) {
        const hits = hitsByRule.get(rule.name);
        if (hits.length === 0 || (!rule.strict && !review)) {
            continue;
        }
        const heading = rule.strict ? "FAIL" : "REVIEW";
        console.log(`${heading} ${rule.name} (${hits.length}): ${rule.message}`);
        for (const hit of hits) {
            console.log(`  ${hit.file}:${hit.line}  ${hit.text}`);
        }
        failed = failed || rule.strict;
    }
    if (review) {
        const sorted = Array.from(verbs.entries()).sort((a, b) => b[1].length - a[1].length);
        console.log(`REVIEW verbs off the glossary (${sorted.length})`);
        for (const [verb, hits] of sorted) {
            console.log(`  ${verb} (${hits.length}): ${hits.slice(0, 4).map(hit => hit.text).join(", ")}`);
        }
    }
    process.exitCode = failed ? 1 : 0;
}

main();
