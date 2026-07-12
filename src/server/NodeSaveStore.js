import BetterSqlite3 from "better-sqlite3";
import {AbstractSaveStore} from "@/common/AbstractSaveStore.js";

// Bookkeeping tables describing the saved component tables + globals (prefixed to avoid colliding
// with a component named the same).
const COMPONENT_META = "_Component";
const FIELD_META = "_Field";
const GLOBAL_TABLE = "_Global";

/**
 * Node {@link AbstractSaveStore}: persists the snapshot as structured SQLite — one table per
 * component (a column per field), plus meta tables recording the component/field descriptors and the
 * global map. Schema is generated from the snapshot, so it stays generic (no per-mod coupling).
 */
export class NodeSaveStore extends AbstractSaveStore {

    /**
     * @param {string} [path] - SQLite file, or ":memory:" for an in-process store
     */
    constructor(path=":memory:") {
        super();
        this.db = new BetterSqlite3(path);
    }

    /**
     * @param {object} snapshot
     * @returns {Promise<void>}
     */
    async save(snapshot) {
        const write = this.db.transaction(() => {
            this._reset();
            this._writeMeta(snapshot.components);
            snapshot.components.forEach((component, index) => this._writeComponent(component, index));
            this._writeGlobals(snapshot.globals);
        });
        write();
    }

    /**
     * @returns {Promise<object|null>}
     */
    async load() {
        const hasSave = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
            .get(COMPONENT_META);
        if (hasSave === undefined) {
            return null;
        }
        return {
            components: this._readComponents(),
            globals: this._readGlobals(),
        };
    }

    /**
     * Drops every table from a prior save so the next one starts clean.
     * @private
     * @returns {void}
     */
    _reset() {
        this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all()
            .forEach(row => this.db.exec(`DROP TABLE "${row.name}"`));
    }

    /**
     * @private
     * @param {object[]} components
     * @returns {void}
     */
    _writeMeta(components) {
        this.db.exec(`CREATE TABLE "${COMPONENT_META}" (name TEXT PRIMARY KEY, seq INTEGER)`);
        this.db.exec(`CREATE TABLE "${FIELD_META}" (component TEXT, name TEXT, kind TEXT, seq INTEGER)`);
        this.db.exec(`CREATE TABLE "${GLOBAL_TABLE}" (key TEXT PRIMARY KEY, value INTEGER)`);

        const componentInsert = this.db.prepare(`INSERT INTO "${COMPONENT_META}" (name, seq) VALUES (?, ?)`);
        const fieldInsert = this.db.prepare(`INSERT INTO "${FIELD_META}" (component, name, kind, seq) VALUES (?, ?, ?, ?)`);
        components.forEach((component, index) => {
            componentInsert.run(component.name, index);
            component.fields.forEach((field, fieldIndex) => {
                fieldInsert.run(component.name, field.name, field.kind, fieldIndex);
            });
        });
    }

    /**
     * @private
     * @param {object} component
     * @returns {void}
     */
    _writeComponent(component) {
        const columns = ["eid", ...component.fields.map(field => field.name)];
        const columnDdl = columns.map(name => `"${name}" INTEGER`).join(", ");
        this.db.exec(`CREATE TABLE "${component.name}" (${columnDdl})`);

        const placeholders = columns.map(() => "?").join(", ");
        const insert = this.db.prepare(`INSERT INTO "${component.name}" (${columns.map(name => `"${name}"`).join(", ")}) VALUES (${placeholders})`);
        component.rows.forEach(row => {
            insert.run(columns.map(name => row[name]));
        });
    }

    /**
     * @private
     * @param {object} globals
     * @returns {void}
     */
    _writeGlobals(globals) {
        const insert = this.db.prepare(`INSERT INTO "${GLOBAL_TABLE}" (key, value) VALUES (?, ?)`);
        Object.entries(globals).forEach(([key, value]) => insert.run(key, value));
    }

    /**
     * @private
     * @returns {object[]}
     */
    _readComponents() {
        const componentRows = this.db
            .prepare(`SELECT name FROM "${COMPONENT_META}" ORDER BY seq`)
            .all();
        const fieldStatement = this.db
            .prepare(`SELECT name, kind FROM "${FIELD_META}" WHERE component=? ORDER BY seq`);

        return componentRows.map(componentRow => {
            const fields = fieldStatement.all(componentRow.name).map(field => ({name: field.name, kind: field.kind}));
            const columns = ["eid", ...fields.map(field => field.name)].map(name => `"${name}"`).join(", ");
            const rows = this.db.prepare(`SELECT ${columns} FROM "${componentRow.name}"`).all();
            return {name: componentRow.name, fields, rows};
        });
    }

    /**
     * @private
     * @returns {object}
     */
    _readGlobals() {
        const globals = {};
        this.db.prepare(`SELECT key, value FROM "${GLOBAL_TABLE}"`).all().forEach(row => {
            globals[row.key] = row.value;
        });
        return globals;
    }
}
