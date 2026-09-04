// The snapshot shape a save carries. Bump on any shape change, with a SAVE_MIGRATIONS entry.
export const SAVE_FORMAT = 4;

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
    [2, snapshot => ({...snapshot, saveFormat: 3, components: addField(snapshot.components, "Machine", "enabled", 1)})],
    // Format 4 tags the object-type and item-type columns, which a loadout change carries over by
    // name; they were plain i32 (records: plain integer) before.
    [3, snapshot => ({
        ...snapshot,
        saveFormat: 4,
        components: retagFields(snapshot.components, ID_FIELD_KINDS),
        records: retagFields(snapshot.records === undefined ? [] : snapshot.records, RECORD_ID_FIELD_KINDS),
    })],
]);

// component.field -> kind, for format 4.
const ID_FIELD_KINDS = new Map([
    ["PlacedObject.typeId", "type"],
    ["Port.item", "item"],
    ["BeltItem.type", "item"],
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
 * @param {number} value
 * @returns {object[]}
 */
function addField(components, componentName, fieldName, value) {
    return components.map(component => {
        if (component.name !== componentName
            || component.fields.some(field => field.name === fieldName)) {
            return component;
        }
        return {
            ...component,
            fields: [...component.fields, {name: fieldName, kind: "i32"}],
            rows: component.rows.map(row => ({...row, [fieldName]: value})),
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
