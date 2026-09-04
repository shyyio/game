// Every component column that holds an item type must be tagged kind "item": a loadout change counts
// and empties columns by kind, so an untagged one keeps an item type no mod declares any more.

import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine} from "@/test/ecsSim.js";

const ITEM_COLUMNS = [
    "Port.item",
    "BeltItem.type",
    "Machine.slot0",
    "Machine.slot1",
    "Machine.slot2",
    "Machine.processing0",
    "Machine.processing1",
    "Machine.processing2",
    "Machine.output",
    "Machine.lastOutput",
    "Machine.byproduct",
    "Machine.lastByproduct",
    "Extractor.output",
    "Extractor.lastOutput",
    "Generator.output",
    "Generator.lastOutput",
    "Generator.output2",
    "Generator.lastOutput2",
    "Gate.buffered",
    "Tank.fluidType",
    "Tank.lastType",
    "PipeNetwork.fluidType",
    "MarketTerminal.itemType",
    "MarketTerminal.lastOutput",
];

test("every column holding an item type is tagged for conversion", async () => {
    const engine = await makeGameEngine();
    const kinds = new Map();
    for (const def of engine.components.defs) {
        for (const field of def.fields) {
            kinds.set(`${def.name}.${field.name}`, field.kind);
        }
    }
    for (const column of ITEM_COLUMNS) {
        assert.equal(kinds.get(column), "item", `${column} holds an item type`);
    }
});
