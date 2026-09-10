import {Direction} from "@/common/constants.js";

// The snapshot shape a save carries. Bump on any shape change, with a SAVE_MIGRATIONS entry.
export const SAVE_FORMAT = 13;

// What a save written before the stamp counts as.
const UNSTAMPED_FORMAT = 0;

/**
 * Upgrades keyed by the format they read: entry N takes a format-N snapshot, returns format N+1.
 * They run on the plain snapshot before any engine sees it, so one chain serves every backend;
 * mutating the input is fine.
 * @type {Map<number, function(object): object>}
 */
export const SAVE_MIGRATIONS = new Map([
    // Format 1 holds the same content as an unstamped save, so stamping is the whole migration.
    [UNSTAMPED_FORMAT, snapshot => ({...snapshot, saveFormat: UNSTAMPED_FORMAT + 1, gameVersion: null})],
    // Format 2 adds the world seed global; worlds saved before it had none, so they keep seed 0.
    [1, snapshot => ({...snapshot, saveFormat: 2, globals: {...snapshot.globals, seed: 0}})],
    // Format 3 adds Machine.enabled, the logic-network switch; machines saved before it run.
    [2, snapshot => ({...snapshot, saveFormat: 3, components: addField(snapshot.components, "Machine", "enabled", "i32", 1)})],
    // Format 4 tags the object-type and item-type columns, which a loadout change carries over by
    // name; they were plain i32 (records: plain integer) before.
    [3, snapshot => ({
        ...snapshot,
        saveFormat: 4,
        components: retagFields(snapshot.components, ID_FIELD_KINDS),
        records: retagFields(snapshot.records === undefined ? [] : snapshot.records, RECORD_ID_FIELD_KINDS),
    })],
    // Format 5 renames PlacedObject.ownerId to placedBy, which now records the placing player. Rows
    // written before it hold the chunk owner at spawn, the closest thing the old save knows.
    [4, snapshot => ({
        ...snapshot,
        saveFormat: 5,
        components: renameField(snapshot.components, "PlacedObject", "ownerId", "placedBy"),
    })],
    // Format 6 moves the gate and tank onto the engine's field sync: their hand-kept last-synced
    // columns go, and the gate gains an empty lastOutput for the fluid it last buffered.
    [5, snapshot => ({
        ...snapshot,
        saveFormat: 6,
        components: addField(
            dropField(dropField(dropField(snapshot.components, "Gate", "lastOpen"), "Gate", "lastFluid"), "Tank", "lastType"),
            "Gate",
            "lastOutput",
            "item",
            -1,
        ),
    })],
    // Format 7 adds transport lanes: a save written before them holds no lane, cell or item rows.
    [6, snapshot => ({
        ...snapshot,
        saveFormat: 7,
        components: addComponents(snapshot.components, LANE_COMPONENTS),
    })],
    // Format 8 renames PlacedObject.typeId to objectTypeId and MarketTerminal.itemType to itemTypeId.
    [7, snapshot => ({
        ...snapshot,
        saveFormat: 8,
        components: renameField(
            renameField(snapshot.components, "PlacedObject", "typeId", "objectTypeId"),
            "MarketTerminal",
            "itemType",
            "itemTypeId",
        ),
    })],
    // Format 9 renames the objectId column on every component holding one to objectRef.
    [8, snapshot => ({
        ...snapshot,
        saveFormat: 9,
        components: renameField(
            renameField(
                renameField(snapshot.components, "PlacedObject", "objectId", "objectRef"),
                "BeltPathMember",
                "objectId",
                "objectRef",
            ),
            "PipeNetworkMember",
            "objectId",
            "objectRef",
        ),
    })],
    // Format 10 renames the ChunkClaim record's chunk column to chunkKey.
    [9, snapshot => ({
        ...snapshot,
        saveFormat: 10,
        records: renameField(snapshot.records === undefined ? [] : snapshot.records, "ChunkClaim", "chunk", "chunkKey"),
    })],
    // Format 11 moves belts onto the engine's lanes: the belt path components go, and every placed
    // belt becomes a lane cell the load re-derives lanes from. Items in flight on a belt are lost.
    [10, snapshot => ({
        ...snapshot,
        saveFormat: 11,
        components: addRows(
            snapshot.components.filter(component => !BELT_PATH_COMPONENTS.has(component.name)),
            "LaneCell",
            placedOfTypes(snapshot, BELT_TYPE_NAMES).map(eid => ({
                eid,
                lane: LANE_CELL_UNLINKED,
                childCell: LANE_CELL_UNLINKED,
                parentEdge: Direction.UP,
            })),
        ),
    })],
    // Format 12 names the Lane port columns by their role.
    [11, snapshot => ({
        ...snapshot,
        saveFormat: 12,
        components: renameField(renameField(snapshot.components, "Lane", "inPort", "inputPort"), "Lane", "outPort", "outputPort"),
    })],
    // Format 13 spells out every port column.
    [12, snapshot => ({
        ...snapshot,
        saveFormat: 13,
        components: PORT_COLUMN_RENAMES.reduce(
            (components, [componentName, from, to]) => renameField(components, componentName, from, to),
            snapshot.components,
        ),
    })],
]);

// The port columns format 13 spells out, as [component, old name, new name].
const PORT_COLUMN_RENAMES = [
    ["Machine", "out", "outputPort"],
    ["Machine", "out2", "outputPort2"],
    ["Machine", "in0", "inputPort0"],
    ["Machine", "in1", "inputPort1"],
    ["Machine", "in2", "inputPort2"],
    ["Gate", "in", "inputPort"],
    ["Gate", "out", "outputPort"],
    ["Gate", "int", "internalPort"],
    ["Tank", "in", "inputPort"],
    ["Tank", "out", "outputPort"],
    ["MarketTerminal", "in", "inputPort"],
    ["MarketTerminal", "out", "outputPort"],
    ["Generator", "out", "outputPort"],
    ["Generator", "out2", "outputPort2"],
    ["Extractor", "out", "outputPort"],
    ["Splitter", "in_a", "inputPortA"],
    ["Splitter", "in_b", "inputPortB"],
    ["Splitter", "out_a", "outputPortA"],
    ["Splitter", "out_b", "outputPortB"],
    ["Splitter", "int_a", "internalPortA"],
    ["Splitter", "int_b", "internalPortB"],
];

// The belt path engine's components, dropped by format 11.
const BELT_PATH_COMPONENTS = new Set(["BeltPath", "BeltPathMember", "BeltItem"]);

// The object types that are lane cells from format 11 on.
const BELT_TYPE_NAMES = new Set(["Belt", "BeltTunnelDown", "BeltTunnelUp", "BeltUnderground"]);

// The eid sentinel a lane cell on no lane stores.
const LANE_CELL_UNLINKED = -1;

// The lane components as format 7 registers them, for the save that predates all three.
const LANE_COMPONENTS = [
    {
        name: "Lane",
        fields: [
            {name: "headCell", kind: "eid"},
            {name: "inPort", kind: "eid"},
            {name: "outPort", kind: "eid"},
            {name: "slotCount", kind: "i32"},
            {name: "itemCount", kind: "i32"},
            {name: "headGap", kind: "i32"},
            {name: "firstItem", kind: "eid"},
            {name: "lastItem", kind: "eid"},
            {name: "nextItemRef", kind: "i32"},
        ],
    },
    {
        name: "LaneCell",
        fields: [
            {name: "lane", kind: "eid"},
            {name: "childCell", kind: "eid"},
            {name: "parentEdge", kind: "i32"},
        ],
    },
    {
        name: "LaneItem",
        fields: [
            {name: "lane", kind: "eid"},
            {name: "nextItem", kind: "eid"},
            {name: "itemTypeId", kind: "item"},
            {name: "gap", kind: "i32"},
            {name: "itemRef", kind: "i32"},
        ],
    },
];

// component.field -> kind, for format 4.
const ID_FIELD_KINDS = new Map([
    ["PlacedObject.typeId", "type"],
    ["Port.item", "item"],
    ["BeltItem.type", "item"],
    ["LaneItem.itemTypeId", "item"],
    ["Machine.slot0", "item"],
    ["Machine.slot1", "item"],
    ["Machine.slot2", "item"],
    ["Machine.processing0", "item"],
    ["Machine.processing1", "item"],
    ["Machine.processing2", "item"],
    ["Machine.output", "item"],
    ["Machine.lastOutput", "item"],
    ["Machine.byproduct", "item"],
    ["Machine.lastByproduct", "item"],
    ["Extractor.output", "item"],
    ["Extractor.lastOutput", "item"],
    ["Generator.output", "item"],
    ["Generator.lastOutput", "item"],
    ["Generator.output2", "item"],
    ["Generator.lastOutput2", "item"],
    ["Gate.buffered", "item"],
    ["PipeNetwork.fluidType", "item"],
    ["Tank.fluidType", "item"],
    ["Tank.lastType", "item"],
    ["MarketTerminal.itemType", "item"],
    ["MarketTerminal.lastOutput", "item"],
]);

// record.field -> kind, for format 4.
const RECORD_ID_FIELD_KINDS = new Map([
    ["ItemProduced.item_type", "item"],
    ["LogicRuleCondition.item_type", "item"],
]);

/**
 * The eids of every placed object whose type is one of `typeNames`.
 * @param {object} snapshot
 * @param {Set<string>} typeNames
 * @returns {number[]}
 */
function placedOfTypes(snapshot, typeNames) {
    const placed = snapshot.components.find(component => component.name === "PlacedObject");
    return placed.rows
        .filter(row => typeNames.has(snapshot.objectTypeNames[row.objectTypeId]))
        .map(row => row.eid);
}

/**
 * Returns `components` with `rows` appended to `componentName`.
 * @param {object[]} components
 * @param {string} componentName
 * @param {object[]} rows
 * @returns {object[]}
 */
function addRows(components, componentName, rows) {
    return components.map(component => {
        if (component.name !== componentName) {
            return component;
        }
        return {...component, rows: component.rows.concat(rows)};
    });
}

/**
 * Returns `components` with each named component appended, holding no rows; one already present is
 * left alone.
 * @param {object[]} components
 * @param {{name: string, fields: {name: string, kind: string}[]}[]} added
 * @returns {object[]}
 */
function addComponents(components, added) {
    const present = new Set(components.map(component => component.name));
    const missing = added
        .filter(component => !present.has(component.name))
        .map(component => ({name: component.name, fields: component.fields, rows: []}));
    return components.concat(missing);
}

/**
 * Returns `components` with the listed fields' kinds replaced; a field not present is skipped.
 * @param {object[]} components
 * @param {Map<string, string>} kinds "Component.field" -> kind
 * @returns {object[]}
 */
function retagFields(components, kinds) {
    return components.map(component => ({
        ...component,
        fields: component.fields.map(field => {
            const kind = kinds.get(`${component.name}.${field.name}`);
            if (kind === undefined) {
                return field;
            }
            return {...field, kind};
        }),
    }));
}

/**
 * Returns `components` with `fieldName` appended to `componentName`, set to `value` on every row.
 * A snapshot missing that component, or already carrying the field, is returned untouched.
 * @param {object[]} components
 * @param {string} componentName
 * @param {string} fieldName
 * @param {string} kind
 * @param {number} value
 * @returns {object[]}
 */
function addField(components, componentName, fieldName, kind, value) {
    return components.map(component => {
        if (component.name !== componentName
            || component.fields.some(field => field.name === fieldName)) {
            return component;
        }
        return {
            ...component,
            fields: [...component.fields, {name: fieldName, kind}],
            rows: component.rows.map(row => ({...row, [fieldName]: value})),
        };
    });
}

/**
 * Returns `components` with `componentName`'s `from` field renamed to `to`, on the field list and on
 * every row. A snapshot missing that component or field is returned untouched.
 * @param {object[]} components
 * @param {string} componentName
 * @param {string} from
 * @param {string} to
 * @returns {object[]}
 */
function renameField(components, componentName, from, to) {
    return components.map(component => {
        if (component.name !== componentName
            || !component.fields.some(field => field.name === from)) {
            return component;
        }
        return {
            ...component,
            fields: component.fields.map(field => {
                if (field.name !== from) {
                    return field;
                }
                return {...field, name: to};
            }),
            rows: component.rows.map(row => {
                const next = {...row, [to]: row[from]};
                delete next[from];
                return next;
            }),
        };
    });
}

/**
 * Returns `components` with `fieldName` removed from `componentName`, on the field list and on every
 * row. A snapshot missing that component or field is returned untouched.
 * @param {object[]} components
 * @param {string} componentName
 * @param {string} fieldName
 * @returns {object[]}
 */
function dropField(components, componentName, fieldName) {
    return components.map(component => {
        if (component.name !== componentName
            || !component.fields.some(field => field.name === fieldName)) {
            return component;
        }
        return {
            ...component,
            fields: component.fields.filter(field => field.name !== fieldName),
            rows: component.rows.map(row => {
                const next = {...row};
                delete next[fieldName];
                return next;
            }),
        };
    });
}

/**
 * Upgrades a loaded snapshot to {@link SAVE_FORMAT} by running each migration in turn.
 * @param {object} snapshot - as read from a save store
 * @param {Map<number, function(object): object>} [migrations] - the chain to walk
 * @returns {object} a snapshot at the current format
 */
export function migrateSnapshot(snapshot, migrations=SAVE_MIGRATIONS) {
    let format = snapshotFormat(snapshot);
    if (format > SAVE_FORMAT) {
        throw new Error(
            `Save is format ${format}, but this build reads ${SAVE_FORMAT}: it was written by a newer `
            + "build. Upgrade the build rather than downgrading the save."
        );
    }
    let migrated = snapshot;
    while (format < SAVE_FORMAT) {
        const migration = migrations.get(format);
        if (migration === undefined) {
            throw new Error(`No migration from save format ${format} to ${format + 1}; this save cannot be upgraded.`);
        }
        migrated = migration(migrated);
        const next = snapshotFormat(migrated);
        if (next !== format + 1) {
            throw new Error(`Migration from save format ${format} left the snapshot at ${next}, not ${format + 1}.`);
        }
        format = next;
    }
    return migrated;
}

/**
 * @param {object} snapshot
 * @returns {number} its declared format, or {@link UNSTAMPED_FORMAT} when it predates the stamp
 */
function snapshotFormat(snapshot) {
    const format = snapshot.saveFormat;
    if (format === undefined || format === null) {
        return UNSTAMPED_FORMAT;
    }
    if (!Number.isInteger(format) || format < 0) {
        throw new Error(`Save declares a nonsense format: ${JSON.stringify(format)}`);
    }
    return format;
}
