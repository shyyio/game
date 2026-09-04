// Carrying a saved world over to another mod loadout. Object typeIds are positional, so a column of
// kind "type" is remapped by name; item types are declared constants, so a column of kind "item"
// only needs values no mod declares any more emptied. A record table's own "item" columns count
// toward the losses; the module that owns the table drops those rows as it deserializes. Objects of a type the next loadout lacks must
// be gone before converting: the caller deletes them through the engine, which is what keeps ports,
// belts and occupancy consistent.

import {EMPTY} from "@/sim/sentinels.js";

const KIND_TYPE = "type";
const KIND_ITEM = "item";

/**
 * @typedef {Object} Loadout
 * @property {string[]} typeNames every object type's name, in typeId order
 * @property {Set<number>} itemTypes every declared item type
 */

/**
 * @typedef {Object} ConversionLosses
 * @property {Map<string, number>} objects object type name -> how many placed objects
 * @property {Map<number, number>} items item type -> how many held in fields
 */

/**
 * @param {object} snapshot
 * @param {string} kind
 * @param {function(number): void} visit called with every value of every field of that kind
 * @returns {void}
 */
function visitValues(snapshot, kind, visit) {
    const records = snapshot.records === undefined ? [] : snapshot.records;
    for (const table of records.concat(snapshot.components)) {
        for (const field of table.fields) {
            if (field.kind !== kind) {
                continue;
            }
            for (const row of table.rows) {
                visit(row[field.name]);
            }
        }
    }
}

/**
 * What moving `snapshot` onto `loadout` would lose.
 * @param {object} snapshot
 * @param {Loadout} loadout
 * @returns {ConversionLosses}
 */
export function conversionLosses(snapshot, loadout) {
    const objects = new Map();
    const items = new Map();
    const kept = new Set(loadout.typeNames);
    visitValues(snapshot, KIND_TYPE, typeId => {
        const name = snapshot.objectTypeNames[typeId];
        if (!kept.has(name)) {
            objects.set(name, (objects.has(name) ? objects.get(name) : 0) + 1);
        }
    });
    visitValues(snapshot, KIND_ITEM, itemType => {
        if (itemType !== EMPTY && !loadout.itemTypes.has(itemType)) {
            items.set(itemType, (items.has(itemType) ? items.get(itemType) : 0) + 1);
        }
    });
    return {objects, items};
}

/**
 * `snapshot` as `loadout` reads it: type columns renumbered, lost items emptied, component tables
 * matched to `componentDefs` (dropped when no longer registered, empty when new) and every row cut
 * down to the fields the next engine registers. Throws on an object whose type the loadout lacks.
 * @param {object} snapshot
 * @param {Loadout} loadout
 * @param {Array<{name: string, fields: Array<{name: string, kind: string, fill: number}>}>} componentDefs the next engine's
 * @returns {object} a new snapshot; the given one is untouched
 */
export function convertSnapshot(snapshot, loadout, componentDefs) {
    const typeIdByName = new Map(loadout.typeNames.map((name, typeId) => [name, typeId]));
    const saved = new Map(snapshot.components.map(component => [component.name, component]));
    const components = componentDefs.map(def => {
        const fields = def.fields.map(field => ({name: field.name, kind: field.kind}));
        const component = saved.get(def.name);
        if (component === undefined) {
            return {name: def.name, fields, rows: []};
        }
        const savedNames = new Set(component.fields.map(field => field.name));
        const rows = component.rows.map(row => {
            const converted = {eid: row.eid};
            for (const field of def.fields) {
                if (!savedNames.has(field.name)) {
                    // A field this loadout added: the save has no value, so the column's own fill stands.
                    converted[field.name] = field.fill;
                } else if (field.kind === KIND_TYPE) {
                    const name = snapshot.objectTypeNames[row[field.name]];
                    if (!typeIdByName.has(name)) {
                        throw new Error(`An object of type ${name} is still in the world; delete it before converting`);
                    }
                    converted[field.name] = typeIdByName.get(name);
                } else if (field.kind === KIND_ITEM && row[field.name] !== EMPTY && !loadout.itemTypes.has(row[field.name])) {
                    converted[field.name] = EMPTY;
                } else {
                    converted[field.name] = row[field.name];
                }
            }
            return converted;
        });
        return {name: def.name, fields, rows};
    });
    return Object.assign({}, snapshot, {
        objectTypeNames: loadout.typeNames.slice(),
        components,
    });
}
