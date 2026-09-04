import {World} from "@/sim/World.js";
import {GAME_VERSION} from "@/common/constants.js";
import {SAVE_FORMAT} from "@/common/saveMigrations.js";
import {NO_EID} from "@/sim/sentinels.js";

/**
 * The engine's save format: the whole world written as a table of rows per registered component
 * plus the global counters, and read back into a fresh world. Reflection over the component
 * registry, so a module keeping its state in components round-trips with no bespoke save code.
 *
 * Reading is guarded: a snapshot at the wrong format, from a different object-type layout, or
 * carrying components this build no longer registers is refused loudly rather than restored into
 * columns that no longer mean the same thing.
 */
export class SnapshotSerializer {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;

        // Hooks run at the start of serialize, letting a bespoke module (belts) flush JS-only runtime
        // state into its registered components so the generic reflection captures it.
        this._serializeHooks = [];
        // Hooks a module registers to rebuild its derived indexes after deserialize repopulates the world.
        this._rebuildHooks = [];
    }

    /**
     * A bespoke module registers a hook run at the start of {@link serialize}, to materialize any
     * JS-only runtime state into its registered components before reflection reads them.
     * @param {function(): void} hook
     * @returns {void}
     */
    registerSerializeHook(hook) {
        this._serializeHooks.push(hook);
    }

    /**
     * A module registers a hook run after {@link deserialize} repopulates the world, to rebuild its own
     * derived indexes from the restored components. Receives the old-eid -> new-eid remap.
     * @param {function(Map<number,number>): void} hook
     * @returns {void}
     */
    registerRebuildHook(hook) {
        this._rebuildHooks.push(hook);
    }

    /**
     * What a snapshot converts against, see @/sim/snapshotConversion.js.
     * @returns {{typeNames: string[], itemTypes: Set<number>}}
     */
    get loadout() {
        const registry = this.engine.modRegistry;
        return {
            typeNames: registry.objectTypes.map(type => type.name),
            itemTypes: new Set(Array.from(registry.items.entries(), entry => entry[0])),
        };
    }

    /**
     * A serializable snapshot of the whole world: every registered component as a table of rows (one
     * per entity holding it), plus the global counters.
     * @returns {{saveFormat:number, gameVersion:string, components:object[], globals:object}}
     */
    serialize() {
        const engine = this.engine;
        for (const hook of this._serializeHooks) {
            hook();
        }
        const components = engine.components.defs.map(def => {
            const rows = [];
            for (const slot of engine.components.slotsOf(def)) {
                const row = {eid: def.eidAt(slot)};
                for (const field of def.fields) {
                    row[field.name] = def.store[field.name][slot];
                }
                rows.push(row);
            }
            // A sparse component's rows shuffle as entities come and go, so order them here: the same
            // world then serializes to the same bytes however it was built.
            rows.sort((a, b) => a.eid - b.eid);
            return {
                name: def.name,
                fields: def.fields.map(field => ({name: field.name, kind: field.kind})),
                rows: rows,
            };
        });
        // Component values are Int32Array-backed, so always safe; only the unbounded globals (id
        // counters) can overflow past 2^53, where Number silently loses precision.
        const globals = engine.saveGlobals();
        for (const key of Object.keys(globals)) {
            if (!Number.isSafeInteger(globals[key])) {
                throw new RangeError(`SnapshotSerializer.serialize: global "${key}" is not a safe integer: ${globals[key]}`);
            }
        }
        // Every object type's name, in typeId order — deserialize compares this against the current
        // loadout so a stale save (object types added/removed/reordered since) fails loudly at load
        // time instead of resolving a component row's typeId to the wrong behavior mid-tick.
        let objectTypeNames = null;
        if (engine.modRegistry !== null) {
            objectTypeNames = engine.modRegistry.objectTypes.map(type => type.name);
        }
        // gameVersion is for humans; load decides on saveFormat.
        return {
            saveFormat: SAVE_FORMAT,
            gameVersion: GAME_VERSION,
            components: components,
            globals: globals,
            objectTypeNames: objectTypeNames,
        };
    }

    /**
     * Rebuilds the world from a {@link serialize} snapshot: fresh entities for every saved eid (eid
     * columns remapped so references stay consistent), then the engine's derived indexes and each
     * module's via its rebuild hook.
     * @param {{components:object[], globals:object}} snapshot
     * @returns {void}
     */
    deserialize(snapshot) {
        const engine = this.engine;
        this._assertFormat(snapshot);
        this._assertLoadoutCompatible(snapshot);
        this._assertComponentsCompatible(snapshot);
        engine.world = new World();
        engine.components.bindAll();
        engine.components.clearAll();
        // Drop the prior world's render/tick state so its stale eids never leak into the new world.
        engine.render.reset();
        engine.transfers.resetTick();

        // Every eid that appears (as a row's own eid or an eid-field target) needs a fresh entity.
        const referenced = new Set();
        for (const component of snapshot.components) {
            for (const row of component.rows) {
                referenced.add(row.eid);
                for (const field of component.fields) {
                    if (field.kind === "eid" && row[field.name] !== NO_EID) {
                        referenced.add(row[field.name]);
                    }
                }
            }
        }
        const remap = new Map();
        for (const old of [...referenced].sort((a, b) => a - b)) {
            remap.set(old, engine.world.addEntity());
        }
        const translate = value => (value === NO_EID ? NO_EID : remap.get(value));

        for (const component of snapshot.components) {
            const def = engine.components.find(component.name);
            for (const row of component.rows) {
                const eid = remap.get(row.eid);
                engine.components.attach(def, eid);
                const slot = def.slot(eid);
                for (const field of def.fields) {
                    const raw = row[field.name];
                    def.store[field.name][slot] = field.kind === "eid" ? translate(raw) : raw;
                }
            }
        }

        engine.restoreGlobals(snapshot.globals);
        engine.space.rebuild();
        engine.ports.rebuild();
        for (const hook of this._rebuildHooks) {
            hook(remap);
        }
    }

    /**
     * Throws when `snapshot` is not at the format this build reads.
     * @private
     * @param {{saveFormat: number|undefined}} snapshot
     * @returns {void}
     */
    _assertFormat(snapshot) {
        if (snapshot.saveFormat === SAVE_FORMAT) {
            return;
        }
        let found = snapshot.saveFormat;
        if (found === undefined || found === null) {
            found = "unstamped (pre-dates save formats)";
        }
        throw new Error(
            `Save is format ${found}, this build reads ${SAVE_FORMAT}: `
            + "run it through migrateSnapshot() before deserializing."
        );
    }

    /**
     * Throws when `snapshot` was written against a different object-type layout than the current
     * loadout: typeIds are positional (assigned by registration order at ModRegistry.freeze()), so
     * adding/removing/reordering a mod's object types shifts every typeId after the change, and a
     * component row's saved typeId would silently resolve to the wrong ObjectType/behavior — a crash
     * deep in an unrelated tick, far from the real cause. A pure append (current has every saved name
     * as a prefix, plus new ones after) is fine; anything else is not. No-op when this engine has no
     * modRegistry (synthetic test engines never persist for real).
     * @private
     * @param {{objectTypeNames: string[]|null|undefined}} snapshot
     * @returns {void}
     */
    _assertLoadoutCompatible(snapshot) {
        if (this.engine.modRegistry === null) {
            return;
        }
        const current = this.engine.modRegistry.objectTypes.map(type => type.name);
        const saved = snapshot.objectTypeNames;
        const prefixMatches = saved !== null && saved !== undefined && saved.length <= current.length
            && saved.every((name, i) => name === current[i]);
        if (!prefixMatches) {
            throw new Error(
                "Save is incompatible with the current mod loadout: object types were added, removed, "
                + "or reordered since this save was written, so typeIds no longer mean the same thing. "
                + `Saved: [${saved === null || saved === undefined ? "unknown (pre-dates this check)" : saved.join(", ")}]. `
                + `Current: [${current.join(", ")}]. Delete or migrate the save file.`
            );
        }
    }

    /**
     * Throws when `snapshot`'s components no longer match the ones this build registers.
     * Rows restore by name against the current ComponentDefs: a dropped component crashes mid-restore,
     * and a drifted field restores silently as a zero-filled column or an i32 read as an eid.
     * @private
     * @param {{components: object[]}} snapshot
     * @returns {void}
     */
    _assertComponentsCompatible(snapshot) {
        const mismatches = [];
        const savedNames = new Set();
        for (const component of snapshot.components) {
            savedNames.add(component.name);
            const def = this.engine.components.find(component.name);
            if (def === undefined) {
                mismatches.push(`component "${component.name}" is in the save but no longer registered`);
                continue;
            }
            const savedKinds = new Map(component.fields.map(field => [field.name, field.kind]));
            for (const field of def.fields) {
                const savedKind = savedKinds.get(field.name);
                if (savedKind === undefined) {
                    mismatches.push(`${component.name}.${field.name} is registered but missing from the save`);
                }
                else if (savedKind !== field.kind) {
                    mismatches.push(`${component.name}.${field.name} was saved as "${savedKind}", now "${field.kind}"`);
                }
            }
            const currentNames = new Set(def.fields.map(field => field.name));
            for (const name of savedKinds.keys()) {
                if (!currentNames.has(name)) {
                    mismatches.push(`${component.name}.${name} is in the save but no longer registered`);
                }
            }
        }
        for (const def of this.engine.components.defs) {
            if (!savedNames.has(def.name)) {
                mismatches.push(`component "${def.name}" is registered but missing from the save`);
            }
        }
        if (mismatches.length > 0) {
            throw new Error(
                "Save is incompatible with this build's components: "
                + `${mismatches.join("; ")}. Add a save migration, or delete the save file.`
            );
        }
    }
}
