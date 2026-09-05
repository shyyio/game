// A packaged mod must register exactly like the same mod does statically: same object types with
// the same positional typeIds, same wire order, same items. Builds every in-repo mod through
// tools/build-mod.js and freezes the result next to the static loadout.

import {test, after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync, readdirSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {ModPackage} from "@/common/ModPackage.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {MOD_PART_SIM, MOD_PART_CLIENT} from "@/common/ModManifest.js";
import {simLoadout, MOD_DIRS} from "@/mods/loadout.js";
import * as sdk from "@/sdk/common.js";
import {buildMod} from "../../tools/build-mod.js";

/**
 * Builds every in-repo mod and registers the built bundles into a frozen registry.
 * @param {string} outRoot
 * @returns {Promise<{registry: ModRegistry, manifests: ModManifest[], bundles: object[]}>}
 */
async function packagedRegistry(outRoot) {
    const registry = new ModRegistry();
    const manifests = [];
    const bundles = [];
    for (const dir of MOD_DIRS) {
        const outDir = join(outRoot, dir);
        const manifest = await buildMod(resolve("src/mods", dir), outDir, {version: "1.0.0"});
        const bundle = await import(pathToFileURL(join(outDir, manifest.entry)).href);
        const sim = manifest.has(MOD_PART_SIM) ? bundle.createSim(sdk) : null;
        registry.register(new ModPackage(bundle.createDeclaration(sdk), {sim}));
        manifests.push(manifest);
        bundles.push(bundle);
    }
    registry.freeze();
    return {registry, manifests, bundles};
}

// Bundling every mod is this file's expensive step, so one build serves every test over it.
const outRoot = mkdtempSync(join(tmpdir(), "pipes-mods-"));
after(() => rmSync(outRoot, {recursive: true, force: true}));
const {registry, manifests, bundles} = await packagedRegistry(outRoot);

/**
 * @param {ModRegistry} registry
 * @returns {[string, number][]}
 */
function typeIds(registry) {
    return registry.objectTypes.map(type => [type.name, type.typeId]);
}

/**
 * The merged item type -> name map of a loadout's declarations.
 * @param {ModPackage[]} packages
 * @returns {[string, string][]}
 */
function itemNames(packages) {
    const names = [];
    for (const pkg of packages) {
        for (const [itemType, definition] of Object.entries(pkg.declaration.items)) {
            names.push([itemType, definition.name]);
        }
    }
    return names.sort();
}

test("built mod packages register identically to the static loadout", () => {
    const staticPackages = simLoadout();
    const staticRegistry = new ModRegistry();
    for (const pkg of staticPackages) {
        staticRegistry.register(pkg);
    }
    staticRegistry.freeze();

    assert.deepEqual(typeIds(registry), typeIds(staticRegistry), "object type ids drifted");
    assert.deepEqual(
        registry.wireClasses.map(cls => cls.name),
        staticRegistry.wireClasses.map(cls => cls.name),
        "wire order drifted",
    );
    assert.deepEqual(itemNames(registry._packages), itemNames(staticPackages), "items drifted");
    assert.deepEqual(
        registry._packages.map(pkg => pkg.declaration.name),
        staticPackages.map(pkg => pkg.declaration.name),
        "declaration names drifted",
    );
    assert.deepEqual(
        registry.simMods.map(mod => mod.constructor.name),
        staticRegistry.simMods.map(mod => mod.constructor.name),
        "sim parts drifted",
    );

    // A client part is packaged but must stay unevaluated headless: its factory exists, and nothing
    // above it touched pixi.
    const clientMods = manifests.filter(manifest => manifest.has(MOD_PART_CLIENT));
    assert.ok(clientMods.length > 0, "no client parts built");
    for (const [index, manifest] of manifests.entries()) {
        assert.equal(typeof bundles[index].createClient === "function", manifest.has(MOD_PART_CLIENT));
    }
});

test("a packaged loadout runs a game", async () => {
    const game = new Game(registry, new GameEngine(registry));
    await game.init();
    const session = new CapturingSession(1);
    game.connect(session);

    // A Market object type placed on a claimed chunk: the sim part's behavior only reaches the
    // right entities if it shares the core's ObjectType instances with the declaration.
    const terminal = registry.objectTypes.find(type => type.name === "TradingTerminal");
    game.dispatchMessage(new ClaimChunkMessage(chunkId(3, 3)), session);
    game.dispatchMessage(new CreateObjectMessage(terminal.typeId, 3, 3, Direction.UP), session);
    game.runTick();

    assert.equal(game.simEngine.placed.eidsOf(terminal.typeId).length, 1);
});

test("a built package is its manifest plus one bundle, art included", async (t) => {
    const textureRoot = mkdtempSync(join(tmpdir(), "pipes-mods-"));
    t.after(() => rmSync(textureRoot, {recursive: true, force: true}));
    const manifest = await buildMod(resolve("src/mods/base-textures"), textureRoot, {version: "2.0.0"});

    assert.equal(manifest.name, "base-textures");
    assert.equal(manifest.version, "2.0.0");
    assert.deepEqual(manifest.files, ["mod.js"]);
    assert.deepEqual(readdirSync(textureRoot).sort(), ["mod.js", "mod.json"]);

    // The atlases are inside the bundle: both images as data URLs, both frame sets as literals.
    const bundle = readFileSync(join(textureRoot, "mod.js"), "utf8");
    assert.equal(bundle.match(/data:image\/png;base64,/g).length, 2);
    assert.match(bundle, /"frames"|frames:/);
});
