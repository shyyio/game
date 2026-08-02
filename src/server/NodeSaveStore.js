import BetterSqlite3 from "better-sqlite3";
import {AbstractSaveStore} from "@/common/AbstractSaveStore.js";

const COMPONENT_META = "_Component";
const FIELD_META = "_Field";
const GLOBAL_TABLE = "_Global";
const RECORD_META = "_Record";
const RECORD_FIELD_META = "_RecordField";
const OBJECT_TYPE_TABLE = "_ObjectType";

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
        const records = snapshot.records === undefined ? [] : snapshot.records;
        this._assertRecordNames(snapshot.components, records);
        const write = this.db.transaction(() => {
            this._reset();
            this._writeMeta(snapshot.components);
            for (const component of snapshot.components) {
                this._writeComponent(component);
            }
            this._writeGlobals(snapshot.globals);
            this._writeObjectTypeNames(snapshot.objectTypeNames);
            this._writeRecordMeta(records);
            for (const table of records) {
                this._writeRecords(table);
            }
        });
        write();
    }

    /**
     * Record tables share the component tables' namespace unprefixed, so a clash breaks loudly
     * before anything is written.
     * @private
     * @param {object[]} components
     * @param {object[]} records
     * @returns {void}
     */
    _assertRecordNames(components, records) {
        const componentNames = new Set(components.map(component => component.name));
        for (const table of records) {
            if (table.name.startsWith("_")) {
                throw new Error(`Record table "${table.name}" collides with the meta-table prefix`);
            }
            if (componentNames.has(table.name)) {
                throw new Error(`Record table "${table.name}" collides with a component`);
            }
        }
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
            records: this._readRecords(),
            objectTypeNames: this._readObjectTypeNames(),
        };
    }

    /**
     * Drops every table from a prior save so the next one starts clean.
     * @private
     * @returns {void}
     */
    _reset() {
        const tableRows = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all();
        for (const row of tableRows) {
            this.db.exec(`DROP TABLE "${row.name}"`);
        }
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
        for (const [index, component] of components.entries()) {
            componentInsert.run(component.name, index);
            for (const [fieldIndex, field] of component.fields.entries()) {
                fieldInsert.run(component.name, field.name, field.kind, fieldIndex);
            }
        }
    }

    /**
     * @private
     * @param {object} component
     * @returns {void}
     */
    _writeComponent(component) {
        const columns = ["eid", ...component.fields.map(field => field.name)];
        const affinities = ["INTEGER", ...component.fields.map(field => field.kind === "f32" ? "REAL" : "INTEGER")];
        const columnDdl = columns.map((name, i) => `"${name}" ${affinities[i]}`).join(", ");
        this.db.exec(`CREATE TABLE "${component.name}" (${columnDdl})`);

        const placeholders = columns.map(() => "?").join(", ");
        const insert = this.db.prepare(`INSERT INTO "${component.name}" (${columns.map(name => `"${name}"`).join(", ")}) VALUES (${placeholders})`);
        for (const row of component.rows) {
            insert.run(columns.map(name => row[name]));
        }
    }

    /**
     * @private
     * @param {object} globals
     * @returns {void}
     */
    _writeGlobals(globals) {
        const insert = this.db.prepare(`INSERT INTO "${GLOBAL_TABLE}" (key, value) VALUES (?, ?)`);
        for (const [key, value] of Object.entries(globals)) {
            insert.run(key, value);
        }
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
     * @param {object[]} records
     * @returns {void}
     */
    _writeRecordMeta(records) {
        this.db.exec(`CREATE TABLE "${RECORD_META}" (name TEXT PRIMARY KEY, seq INTEGER)`);
        this.db.exec(`CREATE TABLE "${RECORD_FIELD_META}" (record TEXT, name TEXT, kind TEXT, seq INTEGER)`);

        const recordInsert = this.db.prepare(`INSERT INTO "${RECORD_META}" (name, seq) VALUES (?, ?)`);
        const fieldInsert = this.db.prepare(`INSERT INTO "${RECORD_FIELD_META}" (record, name, kind, seq) VALUES (?, ?, ?, ?)`);
        for (const [index, table] of records.entries()) {
            recordInsert.run(table.name, index);
            for (const [fieldIndex, field] of table.fields.entries()) {
                fieldInsert.run(table.name, field.name, field.kind, fieldIndex);
            }
        }
    }

    /**
     * @private
     * @param {object} table
     * @returns {void}
     */
    _writeRecords(table) {
        const columns = table.fields.map(field => field.name);
        const affinities = table.fields.map(field => field.kind === "text" ? "TEXT" : "INTEGER");
        const columnDdl = columns.map((name, i) => `"${name}" ${affinities[i]}`).join(", ");
        this.db.exec(`CREATE TABLE "${table.name}" (${columnDdl})`);

        const placeholders = columns.map(() => "?").join(", ");
        const insert = this.db.prepare(`INSERT INTO "${table.name}" (${columns.map(name => `"${name}"`).join(", ")}) VALUES (${placeholders})`);
        for (const row of table.rows) {
            insert.run(columns.map(name => row[name]));
        }
    }

    /**
     * @private
     * @returns {object[]} the record tables, empty when the save predates them
     */
    _readRecords() {
        const hasRecords = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
            .get(RECORD_META);
        if (hasRecords === undefined) {
            return [];
        }
        const recordRows = this.db
            .prepare(`SELECT name FROM "${RECORD_META}" ORDER BY seq`)
            .all();
        const fieldStatement = this.db
            .prepare(`SELECT name, kind FROM "${RECORD_FIELD_META}" WHERE record=? ORDER BY seq`);

        return recordRows.map(recordRow => {
            const fields = fieldStatement.all(recordRow.name).map(field => ({name: field.name, kind: field.kind}));
            const columns = fields.map(field => `"${field.name}"`).join(", ");
            const rows = this.db.prepare(`SELECT ${columns} FROM "${recordRow.name}"`).all();
            return {name: recordRow.name, fields, rows};
        });
    }

    /**
     * @private
     * @returns {object}
     */
    _readGlobals() {
        const globals = {};
        const globalRows = this.db.prepare(`SELECT key, value FROM "${GLOBAL_TABLE}"`).all();
        for (const row of globalRows) {
            globals[row.key] = row.value;
        }
        return globals;
    }

    /**
     * @private
     * @param {string[]|null} names
     * @returns {void}
     */
    _writeObjectTypeNames(names) {
        this.db.exec(`CREATE TABLE "${OBJECT_TYPE_TABLE}" (name TEXT, seq INTEGER)`);
        if (names === null || names === undefined) {
            return;
        }
        const insert = this.db.prepare(`INSERT INTO "${OBJECT_TYPE_TABLE}" (name, seq) VALUES (?, ?)`);
        for (const [index, name] of names.entries()) {
            insert.run(name, index);
        }
    }

    /**
     * @private
     * @returns {string[]|null} null when the save predates this table, or was written by an engine
     *     with no modRegistry
     */
    _readObjectTypeNames() {
        const hasTable = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
            .get(OBJECT_TYPE_TABLE);
        if (hasTable === undefined) {
            return null;
        }
        const rows = this.db.prepare(`SELECT name FROM "${OBJECT_TYPE_TABLE}" ORDER BY seq`).all();
        if (rows.length === 0) {
            return null;
        }
        return rows.map(row => row.name);
    }
}
