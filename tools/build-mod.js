// Builds a mod source directory into a distributable package: a single mod.js (one ESM bundle with
// zero imports, exporting the three factories) plus its mod.json manifest. A mod's assets are
// inlined into the bundle — an image as a data URL, a JSON file as an object literal — so a package
// is one file of code to fetch, hash, and pin.
//
//   node tools/build-mod.js <mod dir> <out dir> --version 1.0.0 [--homepage https://...]
//
// The bundle's shape is a memoized core closure (declaration + everything it reaches) plus lazy sim
// and client closures over it: shared modules keep one identity across parts, while the client
// part's pixi-dependent code never evaluates headless. See docs/mod-distribution.md.

import {readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, statSync} from "node:fs";
import {createHash} from "node:crypto";
import {join, resolve, dirname, basename, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {rollup} from "rollup";
import {
    ModManifest, SDK_VERSION, MOD_PART_DECLARATION, MOD_PART_SIM, MOD_PART_CLIENT,
} from "../src/common/ModManifest.js";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const SDK_SPECIFIERS = ["@/sdk/common.js", "@/sdk/client.js"];
// The single external the SDK specifiers collapse into: one factory argument carries the whole SDK.
const SDK_ID = "\0sdk";
const SDK_GLOBAL = "sdk";
const BUNDLE_NAME = "mod.js";

// Asset types a mod may import. Images become data URLs (pixi loads those directly); JSON becomes a
// frozen object literal, the same shape vite's asset handling hands the static loadout.
const IMAGE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
};

/**
 * Resolves the repo's `@/` alias and relative imports to absolute paths, and marks as external the
 * SDK plus any module the calling pass must not inline.
 * @param {Set<string>} externalIds absolute paths of modules another closure already owns
 * @returns {object} a rollup plugin
 */
function resolvePlugin(externalIds) {
    return {
        name: "pipes-mod-resolve",
        resolveId(source, importer) {
            if (SDK_SPECIFIERS.includes(source)) {
                return {id: SDK_ID, external: true};
            }
            let resolved = null;
            if (source.startsWith("@/")) {
                resolved = join(SRC_DIR, source.slice(2));
            } else if (source.startsWith(".") && importer !== undefined) {
                resolved = resolve(dirname(importer), source);
            } else {
                return null;
            }
            if (externalIds.has(resolved)) {
                return {id: resolved, external: true};
            }
            return resolved;
        },
    };
}

/**
 * Turns a mod's asset imports into inline modules, so the bundle carries its own art.
 * @returns {object} a rollup plugin
 */
function assetPlugin() {
    return {
        name: "pipes-mod-assets",
        load(id) {
            const extension = id.slice(id.lastIndexOf("."));
            if (IMAGE_MIME_TYPES[extension] !== undefined) {
                const base64 = readFileSync(id).toString("base64");
                return `export default "data:${IMAGE_MIME_TYPES[extension]};base64,${base64}";`;
            }
            if (extension === ".json") {
                // Parsed here so a malformed asset fails the build, not the game.
                return `export default ${JSON.stringify(JSON.parse(readFileSync(id, "utf8")))};`;
            }
            return null;
        },
    };
}

/**
 * Every non-spec .js file in `dir`, recursively; an absent directory contributes nothing.
 * @param {string} dir
 * @returns {string[]} absolute paths, sorted
 */
function sourceFilesIn(dir) {
    if (!existsSync(dir)) {
        return [];
    }
    const found = [];
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...sourceFilesIn(path));
        } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".spec.js")) {
            found.push(path);
        }
    }
    return found.sort();
}

/**
 * Opens a rollup build over `input`, collecting the ids of the modules it pulls in.
 * @param {string|string[]} input entry path(s), or "\0entry" for a generated entry
 * @param {Set<string>} externalIds modules another closure already owns
 * @param {string|null} virtualSource source of the generated entry, when input is "\0entry"
 * @returns {Promise<{build: object, moduleIds: string[]}>}
 */
async function openBuild(input, externalIds, virtualSource) {
    const moduleIds = [];
    const virtualPlugin = {
        name: "pipes-mod-virtual",
        resolveId(source) {
            if (source === "\0entry") {
                return source;
            }
            return null;
        },
        load(id) {
            if (id === "\0entry") {
                return virtualSource;
            }
            return null;
        },
        moduleParsed(info) {
            if (info.id !== "\0entry") {
                moduleIds.push(info.id);
            }
        },
    };
    const build = await rollup({
        input,
        plugins: [virtualPlugin, resolvePlugin(externalIds), assetPlugin()],
        // A mod's own modules are its only dependencies; anything unresolved is a boundary bug.
        // Cycles between a mod's own modules are legal ESM and bundle fine.
        onwarn(warning) {
            if (warning.code === "CIRCULAR_DEPENDENCY") {
                return;
            }
            throw new Error(`rollup: ${warning.message}`);
        },
    });
    return {build, moduleIds};
}

/**
 * The module graph rooted at `roots`, for deciding what the core closure owns.
 * @param {string[]} roots
 * @returns {Promise<string[]>} absolute paths
 */
async function discoverModules(roots) {
    const {build, moduleIds} = await openBuild(roots, new Set(), null);
    await build.close();
    return moduleIds;
}

/**
 * Bundles one entry into a single IIFE, with `externalIds` (plus the SDK) left as free variables.
 * @param {string} input entry path, or "\0entry" for a generated entry
 * @param {Set<string>} externalIds
 * @param {Map<string, string>} globals external id -> the variable name the wrapper binds it to
 * @param {string|null} [virtualSource]
 * @returns {Promise<string>}
 */
async function bundlePart(input, externalIds, globals, virtualSource = null) {
    const {build} = await openBuild(input, externalIds, virtualSource);
    const {output} = await build.generate({
        format: "iife",
        name: "__part",
        globals: Object.fromEntries(globals),
        // The wrapper module is already strict; a nested directive only adds noise.
        strict: false,
    });
    await build.close();
    return output[0].code;
}

/**
 * The mod's core: the declaration and every module it or the mod's shared `common/` code reaches.
 * Bundled through a virtual entry exporting one namespace object per module, so the other parts can
 * bind to the very same instances.
 * @param {string} modDir
 * @returns {Promise<{code: string, moduleIds: string[]}>}
 */
async function buildCore(modDir) {
    const roots = [join(modDir, "declaration.js"), ...sourceFilesIn(join(modDir, "common"))];
    if (!existsSync(roots[0])) {
        throw new Error(`${modDir} has no declaration.js`);
    }
    // First pass: discover the module graph the core owns.
    const discovered = (await discoverModules(roots)).sort();
    // The declaration is index 0 for createDeclaration; the rest follow in a stable order.
    const declarationId = roots[0];
    const ordered = [declarationId, ...discovered.filter(id => id !== declarationId)];
    const imports = ordered.map((id, index) => `import * as m${index} from ${JSON.stringify(id)};`);
    const source = `${imports.join("\n")}\nexport const coreModules = [${ordered.map((unused, index) => `m${index}`).join(", ")}];\n`;
    const code = await bundlePart("\0entry", new Set(), new Map([[SDK_ID, SDK_GLOBAL]]), source);
    return {code, moduleIds: ordered};
}

/**
 * Bundles an optional part entry against the core.
 * @param {string} entryPath
 * @param {string[]} coreModuleIds
 * @returns {Promise<string|null>} the IIFE, or null when the mod has no such part
 */
async function buildPart(entryPath, coreModuleIds) {
    if (!existsSync(entryPath)) {
        return null;
    }
    const externalIds = new Set(coreModuleIds);
    const globals = new Map([[SDK_ID, SDK_GLOBAL]]);
    coreModuleIds.forEach((id, index) => globals.set(id, `__c${index}`));
    return await bundlePart(entryPath, externalIds, globals);
}

/**
 * The kebab-case package name for a mod directory (BaseTextures -> base-textures).
 * @param {string} modDir
 * @returns {string}
 */
function packageName(modDir) {
    return basename(modDir)
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase();
}

/**
 * Assembles the single-file bundle: the memoized core closure plus one lazy closure per part.
 * @param {object} parts
 * @param {string} parts.core
 * @param {string|null} parts.sim
 * @param {string|null} parts.client
 * @param {number} coreModuleCount
 * @returns {string}
 */
function assembleBundle({core, sim, client}, coreModuleCount) {
    const bindings = Array.from({length: coreModuleCount}, (unused, index) => `__c${index}`);
    const partFactory = (code, name, part) => `
export function ${name}(sdk) {
    const [${bindings.join(", ")}] = __coreOf(sdk);
    ${code.split("\n").join("\n    ")}
    return new (__only(__part, ${JSON.stringify(part)}))();
}
`;
    const factories = [`
export function createDeclaration(sdk) {
    return new (__only(__coreOf(sdk)[0], ${JSON.stringify(MOD_PART_DECLARATION)}))();
}
`];
    if (sim !== null) {
        factories.push(partFactory(sim, "createSim", MOD_PART_SIM));
    }
    if (client !== null) {
        factories.push(partFactory(client, "createClient", MOD_PART_CLIENT));
    }
    return `// Built by tools/build-mod.js — do not edit.

let __coreModules = null;

function __coreOf(sdk) {
    if (__coreModules === null) {
        ${core.split("\n").join("\n        ")}
        __coreModules = __part.coreModules;
    }
    return __coreModules;
}

function __only(namespace, part) {
    const names = Object.keys(namespace);
    if (names.length !== 1) {
        throw new Error("A mod's " + part + " module must export exactly one class, found " + names.length);
    }
    return namespace[names[0]];
}
${factories.join("")}`;
}

/**
 * @param {string} path
 * @returns {string} the file's sha-256, in the integrity form the lockfile pins
 */
function fileHash(path) {
    return `sha256-${createHash("sha256").update(readFileSync(path)).digest("base64")}`;
}

/**
 * @param {string[]} argv
 * @returns {Map<string, string>}
 */
function parseFlags(argv) {
    const flags = new Map();
    for (let index = 0; index < argv.length; index += 2) {
        if (!argv[index].startsWith("--") || argv[index + 1] === undefined) {
            throw new Error(`Bad argument: ${argv[index]}`);
        }
        flags.set(argv[index].slice(2), argv[index + 1]);
    }
    return flags;
}

/**
 * Builds `modDir` into `outDir`.
 * @param {string} modDir
 * @param {string} outDir
 * @param {object} options
 * @param {string} options.version
 * @param {string} [options.homepage]
 * @returns {Promise<ModManifest>}
 */
export async function buildMod(modDir, outDir, {version, homepage}) {
    const core = await buildCore(modDir);
    const sim = await buildPart(join(modDir, "sim.js"), core.moduleIds);
    const client = await buildPart(join(modDir, "client.js"), core.moduleIds);
    const parts = [MOD_PART_DECLARATION];
    if (sim !== null) {
        parts.push(MOD_PART_SIM);
    }
    if (client !== null) {
        parts.push(MOD_PART_CLIENT);
    }
    const manifest = ModManifest.parse({
        name: packageName(modDir),
        version,
        sdkVersion: SDK_VERSION,
        entry: BUNDLE_NAME,
        parts,
        ...(homepage === undefined ? {} : {homepage}),
    });

    mkdirSync(outDir, {recursive: true});
    writeFileSync(join(outDir, BUNDLE_NAME), assembleBundle({core: core.code, sim, client}, core.moduleIds.length));
    writeFileSync(join(outDir, "mod.json"), `${JSON.stringify(manifest.toJSON(), null, 4)}\n`);
    return manifest;
}

async function main() {
    const [modArg, outArg, ...rest] = process.argv.slice(2);
    if (modArg === undefined || outArg === undefined) {
        throw new Error("usage: build-mod.js <mod dir> <out dir> --version <x.y.z> [--homepage <url>]");
    }
    const flags = parseFlags(rest);
    const version = flags.get("version");
    if (version === undefined) {
        throw new Error("--version is required");
    }
    const modDir = resolve(modArg);
    const outDir = resolve(outArg);
    const manifest = await buildMod(modDir, outDir, {version, homepage: flags.get("homepage")});
    console.log(`${manifest.name} ${manifest.version} (sdk ${manifest.sdkVersion}) -> ${relative(process.cwd(), outDir)}`);
    for (const file of manifest.files) {
        const path = join(outDir, file);
        console.log(`  ${file}  ${statSync(path).size} bytes  ${fileHash(path)}`);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await main();
}
