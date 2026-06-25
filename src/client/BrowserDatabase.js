import initSqlJs from "sql.js";
import {AbstractDatabase, formatRow} from "@/common/AbstractDatabase.js";
import wasmFile from "@/assets/sql-wasm.wasm?url";
import {gzipCompress} from "@/common/util.js";

export class BrowserDatabase extends AbstractDatabase {

    constructor(schema) {
        super(schema);

        this.statements = {};
        this.db = null;
        this.profilingData = {};
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
     * @private
     */
    _postInit() {

        this.schema.tempSchema.forEach(stmt => this.db.run(stmt));

        Object.entries(this.schema.preparedStatements).forEach(([name, stmt]) => {
            try {
                this.statements[name] = this.db.prepare(stmt);
            } catch (e) {
                console.error(`Failed to prepare statement "${name}":`, e.message);
                throw e;
            }

            this.profilingData[name] = [];
        });
    }

    exec(name, args) {
        const stmt = this.statements[name];

        if (stmt === undefined) {
            throw new Error(`Unknown prepared statement: ${name}`);
        }

        stmt.bind(this.formatArgs(args));

        if (this.debug) {
            console.log(name + (args ? " " + JSON.stringify(args) : ""));
        }

        const startTime = performance.now();
        stmt.step();
        stmt.reset();
        const duration = performance.now() - startTime;

        this.profilingData[name].push(duration);

        return this.db.getRowsModified();
    }

    query(name, args) {
        const stmt = this.statements[name];

        if (stmt === undefined) {
            throw new Error(`Unknown prepared statement: ${name}`);
        }

        stmt.bind(this.formatArgs(args));

        const result = [];

        if (this.debug) {
            console.log(name + (args ? " " + JSON.stringify(args) : "") + " ?");
        }

        const startTime = performance.now();
        while (stmt.step()) {
            result.push(formatRow(stmt.getAsObject(null, {useBigInt: true})));
        }
        const duration = performance.now() - startTime;
        this.profilingData[name].push(duration);

        return result;
    }

    /**
     * Executes raw SQL ignoring result rows; for debugging only.
     * @param {string} sql
     */
    rawExec(sql) {
        this.db.run(sql);
    }

    exportDb() {
        this.db.run("VACUUM;");
        const data = this.db.export();
        this._postInit();

        gzipCompress(data).then(blob => {
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = "save.sqlite3.gz";
            document.body.appendChild(a);
            a.click();

            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
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

    async debugPrintDbSize() {
        this.db.run("VACUUM;");

        const pageCount = this.db.exec("PRAGMA page_count;")[0].values[0][0];
        const pageSize = this.db.exec("PRAGMA page_size;")[0].values[0][0];
        const size = pageCount * pageSize;

        console.log(`${size/1024}kB (${(size/(1024*1024)).toFixed(2)}MB)`)
    }
}