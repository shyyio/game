import {EMPTY} from "@/sim/AbstractComponent.js";
// Carrying a saved world over to another mod loadout. Object objectTypeIds are positional, so a column of
// kind "type" is remapped by name; item types are declared constants, so a column of kind "item"
// only needs values no mod declares any more emptied. A table's own "item" columns count
// toward the losses; the module that owns the table drops those rows as it deserializes. Objects of a type the next loadout lacks must
// be gone before converting: the caller deletes them through the engine, which is what keeps ports,
// belts and occupancy consistent.


const KIND_TYPE = "type";
const KIND_ITEM = "item";

/**
 * @typedef {Object} Loadout
 * @property {string[]} typeNames every object type's name, in objectTypeId order
 * @property {Set<number>} itemTypeIds every declared item type
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
    const tables = snapshot.tables === undefined ? [] : snapshot.tables;
    for (const table of tables.concat(snapshot.components)) {
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
    visitValues(snapshot, KIND_TYPE, objectTypeId => {
        const name = snapshot.objectTypeNames[objectTypeId];
        if (!kept.has(name)) {
            objects.set(name, (objects.has(name) ? objects.get(name) : 0) + 1);
        }
    });
    visitValues(snapshot, KIND_ITEM, itemTypeId => {
        if (itemTypeId !== EMPTY && !loadout.itemTypeIds.has(itemTypeId)) {
            items.set(itemTypeId, (items.has(itemTypeId) ? items.get(itemTypeId) : 0) + 1);
        }
    });
    return {objects, items};
}

/**
 * `snapshot` as `loadout` reads it: type columns renumbered, lost items emptied, component tables
 * matched to `registered` (dropped when no longer registered, empty when new) and every row cut
 * down to the fields the next engine registers. Throws on an object whose type the loadout lacks.
 * @param {object} snapshot
 * @param {Loadout} loadout
 * @param {AbstractComponent[]} registered the next engine's
 * @returns {object} a new snapshot; the given one is untouched
 */
export function convertSnapshot(snapshot, loadout, registered) {
    const objectTypeIdByName = new Map(loadout.typeNames.map((name, objectTypeId) => [name, objectTypeId]));
    const saved = new Map(snapshot.components.map(component => [component.name, component]));
    const components = registered.map(component => convertComponent(snapshot, loadout, objectTypeIdByName, component, saved.get(component.name)));
    return Object.assign({}, snapshot, {
        objectTypeNames: loadout.typeNames.slice(),
        components,
    });
}

/**
 * One registered component's table as `loadout` reads it; empty when the save holds no such table.
 * @param {object} snapshot
 * @param {Loadout} loadout
 * @param {Map<string, number>} objectTypeIdByName
 * @param {AbstractComponent} component
 * @param {TableSnapshot|undefined} savedComponent
 * @returns {TableSnapshot}
 */
function convertComponent(snapshot, loadout, objectTypeIdByName, component, savedComponent) {
    const fields = component.fields.map(field => ({name: field.name, kind: field.kind}));
    if (savedComponent === undefined) {
        return {name: component.name, fields, rows: []};
    }
    const savedNames = new Set(savedComponent.fields.map(field => field.name));
    const rows = savedComponent.rows.map(row => {
        const converted = {eid: row.eid};
        for (const field of component.fields) {
            if (!savedNames.has(field.name)) {
                // A field this loadout added: the save has no value, so the column's own default stands.
                converted[field.name] = field.defaultValue;
            } else if (field.kind === KIND_TYPE) {
                const name = snapshot.objectTypeNames[row[field.name]];
                if (!objectTypeIdByName.has(name)) {
                    throw new Error(`An object of type ${name} is still in the world; delete it before converting`);
                }
                converted[field.name] = objectTypeIdByName.get(name);
            } else if (field.kind === KIND_ITEM && row[field.name] !== EMPTY && !loadout.itemTypeIds.has(row[field.name])) {
                converted[field.name] = EMPTY;
            } else {
                converted[field.name] = row[field.name];
            }
        }
        return converted;
    });
    return {name: component.name, fields, rows};
}
