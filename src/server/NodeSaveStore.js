import BetterSqlite3 from "better-sqlite3";
import {AbstractSaveStore} from "@/common/AbstractSaveStore.js";

const COMPONENT_META = "_Component";
const FIELD_META = "_Field";
const GLOBAL_TABLE = "_Global";
const TABLE_META = "_Table";
const TABLE_FIELD_META = "_TableField";
const OBJECT_TYPE_TABLE = "_ObjectType";
const META_TABLE = "_Meta";

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
     * @returns {void}
     */
    close() {
        this.db.close();
    }

    /**
     * @param {object} snapshot
     * @returns {Promise<void>}
     */
    async save(snapshot) {
        const tables = snapshot.tables === undefined ? [] : snapshot.tables;
        this._assertTableNames(snapshot.components, tables);
        const write = this.db.transaction(() => {
            this._reset();
            this._writeSnapshotMeta(snapshot);
            this._writeMeta(snapshot.components);
            for (const component of snapshot.components) {
                this._writeComponent(component);
            }
            this._writeGlobals(snapshot.globals);
            this._writeObjectTypeNames(snapshot.objectTypeNames);
            this._writeTableMeta(tables);
            for (const table of tables) {
                this._writeTable(table);
            }
        });
        write();
    }

    /**
     * Tables share the component tables' namespace unprefixed, so a clash breaks loudly
     * before anything is written.
     * @private
     * @param {object[]} components
     * @param {object[]} tables
     * @returns {void}
     */
    _assertTableNames(components, tables) {
        const componentNames = new Set(components.map(component => component.name));
        for (const table of tables) {
            if (table.name.startsWith("_")) {
                throw new Error(`Table "${table.name}" collides with the meta-table prefix`);
            }
            if (componentNames.has(table.name)) {
                throw new Error(`Table "${table.name}" collides with a component`);
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
            ...this._readSnapshotMeta(),
            components: this._readComponents(),
            globals: this._readGlobals(),
            tables: this._readTables(),
            objectTypeNames: this._readObjectTypeNames(),
        };
    }

    /**
     * The snapshot's format/version stamp. Own table, not a _Global row: globals are integers.
     * @private
     * @param {{saveFormat: number, gameVersion: string|null}} snapshot
     * @returns {void}
     */
    _writeSnapshotMeta(snapshot) {
        this.db.exec(`CREATE TABLE "${META_TABLE}" (key TEXT PRIMARY KEY, value TEXT)`);
        const insert = this.db.prepare(`INSERT INTO "${META_TABLE}" (key, value) VALUES (?, ?)`);
        insert.run("saveFormat", String(snapshot.saveFormat));
        let gameVersion = snapshot.gameVersion;
        if (gameVersion === undefined) {
            gameVersion = null;
        }
        insert.run("gameVersion", gameVersion);
    }

    /**
     * @private
     * @returns {{saveFormat?: number, gameVersion?: string|null}} empty when the save predates the
     *     stamp, so migrateSnapshot reads it as unstamped
     */
    _readSnapshotMeta() {
        const hasTable = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
            .get(META_TABLE);
        if (hasTable === undefined) {
            return {};
        }
        const rows = this.db.prepare(`SELECT key, value FROM "${META_TABLE}"`).all();
        const values = new Map(rows.map(row => [row.key, row.value]));
        const savedFormat = values.get("saveFormat");
        let saveFormat = null;
        if (savedFormat !== undefined && savedFormat !== null) {
            saveFormat = Number(savedFormat);
        }
        let gameVersion = values.get("gameVersion");
        if (gameVersion === undefined) {
            gameVersion = null;
        }
        return {saveFormat: saveFormat, gameVersion: gameVersion};
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
     * @param {object[]} tables
     * @returns {void}
     */
    _writeTableMeta(tables) {
        this.db.exec(`CREATE TABLE "${TABLE_META}" (name TEXT PRIMARY KEY, seq INTEGER)`);
        this.db.exec(`CREATE TABLE "${TABLE_FIELD_META}" (tableName TEXT, name TEXT, kind TEXT, seq INTEGER)`);

        const tableInsert = this.db.prepare(`INSERT INTO "${TABLE_META}" (name, seq) VALUES (?, ?)`);
        const fieldInsert = this.db.prepare(`INSERT INTO "${TABLE_FIELD_META}" (tableName, name, kind, seq) VALUES (?, ?, ?, ?)`);
        for (const [index, table] of tables.entries()) {
            tableInsert.run(table.name, index);
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
    _writeTable(table) {
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
     * @returns {object[]} the tables, empty when the save predates them
     */
    _readTables() {
        const hasTables = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
            .get(TABLE_META);
        if (hasTables === undefined) {
            return [];
        }
        const tableRows = this.db
            .prepare(`SELECT name FROM "${TABLE_META}" ORDER BY seq`)
            .all();
        const fieldStatement = this.db
            .prepare(`SELECT name, kind FROM "${TABLE_FIELD_META}" WHERE tableName=? ORDER BY seq`);

        return tableRows.map(tableRow => {
            const fields = fieldStatement.all(tableRow.name).map(field => ({name: field.name, kind: field.kind}));
            const columns = fields.map(field => `"${field.name}"`).join(", ");
            const rows = this.db.prepare(`SELECT ${columns} FROM "${tableRow.name}"`).all();
            return {name: tableRow.name, fields, rows};
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
