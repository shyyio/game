// Tool ids must be unique across derived (ObjectType.toolId) and bespoke tools; a collision only
// throws when a client gathers its toolbar, so this holds the invariant headless. Bespoke ids are
// read as source because their tool classes pull in pixi.

import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, globSync} from "node:fs";
import {ecsModRegistry} from "@/test/ecsSim.js";

const BESPOKE_ID_PATTERN = /get id\(\)\s*\{\s*return (\d+);/g;
const TOOL_ID_CONSTANT_PATTERN = /_TOOL_ID = (\d+);/g;

/**
 * Every hand-coded bespoke tool id: literal `get id()` returns plus `*_TOOL_ID` constants.
 * @returns {Map<number, string>} id -> the file claiming it
 */
function bespokeToolIds() {
    const claims = new Map();
    const files = [
        ...globSync("src/client/input/*.js"),
        ...globSync("src/mods/*/client/*.js"),
        ...globSync("src/mods/*/common/constants.js"),
    ];
    for (const file of files) {
        const source = readFileSync(file, "utf8");
        for (const pattern of [BESPOKE_ID_PATTERN, TOOL_ID_CONSTANT_PATTERN]) {
            for (const match of source.matchAll(pattern)) {
                claims.set(Number(match[1]), file);
            }
        }
    }
    return claims;
}

test("every tool id is claimed exactly once across bespoke tools and object types", () => {
    const claims = bespokeToolIds();
    for (const type of ecsModRegistry().objectTypes) {
        if (type.toolId === null) {
            continue;
        }
        const holder = claims.get(type.toolId);
        assert.equal(holder, undefined, `toolId ${type.toolId} of ${type.name} is already claimed by ${holder}`);
        claims.set(type.toolId, type.name);
    }
});
