import {test} from "node:test";
import assert from "node:assert/strict";
import {conversionLosses, convertSnapshot} from "@/sim/snapshotConversion.js";
import {EMPTY} from "@/sim/sentinels.js";

const IRON = 100;
const GOLD = 101;

/**
 * @returns {object} a snapshot from a loadout of [Belt, Gadget, Furnace] with iron and gold items
 */
function snapshot() {
    return {
        saveFormat: 3,
        gameVersion: "4.0.0",
        objectTypeNames: ["Belt", "Gadget", "Furnace"],
        globals: {nextObjectId: 9},
        components: [
            {
                name: "PlacedObject",
                fields: [{name: "typeId", kind: "type"}, {name: "objectId", kind: "i32"}],
                rows: [{eid: 1, typeId: 0, objectId: 1}, {eid: 2, typeId: 2, objectId: 2}, {eid: 3, typeId: 1, objectId: 3}],
            },
            {
                name: "Port",
                fields: [{name: "item", kind: "item"}],
                rows: [{eid: 4, item: IRON}, {eid: 5, item: GOLD}, {eid: 6, item: EMPTY}, {eid: 7, item: GOLD}],
            },
            {
                name: "Gadgetry",
                fields: [{name: "charge", kind: "i32"}],
                rows: [{eid: 3, charge: 5}],
            },
        ],
        records: [
            {name: "Player", fields: [{name: "player_id", kind: "integer"}], rows: []},
            {
                name: "ItemProduced",
                fields: [{name: "player_id", kind: "integer"}, {name: "item_type", kind: "item"}],
                rows: [{player_id: 1, item_type: IRON}, {player_id: 1, item_type: GOLD}],
            },
        ],
    };
}

// The next loadout drops Gadget (and its Gadgetry component), adds Pump first, and no longer has gold.
const NEXT = {typeNames: ["Pump", "Belt", "Furnace"], itemTypes: new Set([IRON])};
const NEXT_DEFS = [
    {name: "PlacedObject", fields: [{name: "typeId", kind: "type"}, {name: "objectId", kind: "i32"}]},
    {name: "Port", fields: [{name: "item", kind: "item"}]},
    {name: "PumpState", fields: [{name: "pressure", kind: "i32"}]},
];

test("the losses name every object type and item the next loadout lacks, with counts", () => {
    const losses = conversionLosses(snapshot(), NEXT);
    assert.deepEqual([...losses.objects], [["Gadget", 1]]);
    assert.deepEqual([...losses.items], [[GOLD, 3]], "two on ports, one in the record table");
});

test("the losses count the item types a record table holds too", () => {
    const records = snapshot();
    records.components = [];
    assert.deepEqual([...conversionLosses(records, NEXT).items], [[GOLD, 1]]);
});

test("a loadout that only appends loses nothing", () => {
    const losses = conversionLosses(snapshot(), {typeNames: ["Belt", "Gadget", "Furnace", "Pump"], itemTypes: new Set([IRON, GOLD])});
    assert.equal(losses.objects.size, 0);
    assert.equal(losses.items.size, 0);
});

test("converting remaps type ids by name, empties lost items, and swaps the component tables", () => {
    const before = snapshot();
    before.components[0].rows.splice(2, 1);
    const converted = convertSnapshot(before, NEXT, NEXT_DEFS);
    assert.deepEqual(converted.objectTypeNames, ["Pump", "Belt", "Furnace"]);
    const placed = converted.components.find(component => component.name === "PlacedObject");
    assert.deepEqual(placed.rows.map(row => row.typeId), [1, 2]);
    const port = converted.components.find(component => component.name === "Port");
    assert.deepEqual(port.rows.map(row => row.item), [IRON, EMPTY, EMPTY, EMPTY]);
    assert.deepEqual(converted.components.map(component => component.name), ["PlacedObject", "Port", "PumpState"]);
    assert.deepEqual(converted.components[2], {name: "PumpState", fields: NEXT_DEFS[2].fields, rows: []});
    assert.deepEqual(converted.globals, {nextObjectId: 9});
    assert.equal(converted.records.length, 2);
    assert.equal(before.components[0].rows[0].typeId, 0);
});

test("a component that gained a field carries it on every row, at the new column's fill", () => {
    const before = snapshot();
    before.components[0].rows.splice(2, 1);
    const defs = NEXT_DEFS.slice();
    defs[1] = {name: "Port", fields: [{name: "item", kind: "item", fill: EMPTY}, {name: "flow", kind: "i32", fill: -7}]};
    const port = convertSnapshot(before, NEXT, defs).components.find(component => component.name === "Port");
    assert.deepEqual(port.rows.map(row => row.flow), [-7, -7, -7, -7]);
});

test("converting refuses a snapshot that still holds an object of a lost type", () => {
    assert.throws(() => convertSnapshot(snapshot(), NEXT, NEXT_DEFS), /Gadget/);
});
