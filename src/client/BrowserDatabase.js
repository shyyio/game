import initSqlJs from "sql.js";
import {AbstractDatabase, formatRow} from "@/common/AbstractDatabase.js";
import wasmFile from "@/assets/sql-wasm.wasm?url";

export class BrowserDatabase extends AbstractDatabase {

    constructor(schema) {
        super(schema);

        this.db = null;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {

        const SQL = await initSqlJs({
            // https://sql.js.org/dist/sql-wasm.wasm
            locateFile: file => wasmFile
        });

        this.db = new SQL.Database({useBigInt: true});
        this.schema.pragma.forEach(stmt => this.db.run(stmt));
        this.schema.initSchema.forEach(stmt => this.db.run(stmt));

        this._postInit();
    }

    /**
     * @protected
     * @param {string} sql
     * @returns {*}
     */
    _prepareStatement(sql) {
        return this.db.prepare(sql);
    }

    /**
     * @protected
     * @param {*} stmt
     * @param [args] {*}
     * @returns {number}
     */
    _exec(stmt, args) {
        stmt.bind(this.formatArgs(args));
        stmt.step();
        stmt.reset();

        return this.db.getRowsModified();
    }

    /**
     * @protected
     * @param {*} stmt
     * @param [args] {*}
     * @returns {*[]}
     */
    _query(stmt, args) {
        stmt.bind(this.formatArgs(args));

        const result = [];

        while (stmt.step()) {
            result.push(formatRow(stmt.getAsObject(null, {useBigInt: true})));
        }

        return result;
    }

    /**
     * Executes raw SQL ignoring result rows; for debugging only.
     * @param {string} sql
     */
    rawExec(sql) {
        this.db.run(sql);
    }

    /**
     * Dumps every table's rows as a plain JSON object keyed by table name; debugging only.
     * @returns {object}
     */
    dump() {
        const tables = this.db.exec(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        );
        const dump = {};
        if (tables.length === 0) {
            return dump;
        }
        tables[0].values.forEach(([name]) => {
            const result = this.db.exec(`SELECT * FROM "${name}"`);
            if (result.length === 0) {
                dump[name] = [];
                return;
            }
            const {columns, values} = result[0];
            dump[name] = values.map(row => {
                const obj = {};
                columns.forEach((column, i) => {
                    // BigInt ids aren't JSON-serializable; narrow them for the dump.
                    const value = row[i];
                    obj[column] = typeof value === "bigint" ? Number(value) : value;
                });
                return obj;
            });
        });
        return dump;
    }
}