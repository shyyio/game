
import BetterSqlite3 from "better-sqlite3";
import {Database, formatRow} from "@/common/database.js";

export class NodeDatabase extends Database {

    constructor(schema) {
        super(schema);
        this.statements = {};
        this.db = null;
    }

    async init() {
        this.db = new BetterSqlite3(":memory:");
        this.db.defaultSafeIntegers(true);
        this.schema.pragma.forEach(sql => this.db.exec(sql));
        this.schema.initSchema.forEach(sql => this.db.exec(sql));
        this._postInit();
    }

    _postInit() {
        this.schema.tempSchema.forEach(sql => this.db.exec(sql));

        Object.entries(this.schema.preparedStatements).forEach(([name, sql]) => {
            try {
                this.statements[name] = this.db.prepare(sql);
            } catch (e) {
                console.error(`Failed to prepare statement "${name}":`, e.message);
                throw e;
            }
        });
    }

    formatArgs(args) {
        if (!args) {
            return {};
        }
        const result = {};
        Object.entries(args).forEach(([key, value]) => {
            result[key] = typeof value === "bigint" ? value.toString() : value;
        });
        return result;
    }

    exec(name, args) {
        const stmt = this.statements[name];
        const info = stmt.run(this.formatArgs(args));
        return info.changes;
    }

    query(name, args) {
        const stmt = this.statements[name];
        const rows = stmt.all(this.formatArgs(args));
        return rows.map(formatRow);
    }

    /**
     * Run raw SQL and return the first column of the first row, or undefined if no rows.
     * For use in tests only.
     * @param {string} sql
     * @returns {*}
     */
    rawScalar(sql) {
        const stmt = this.db.prepare(sql);
        const row = stmt.get();
        if (row === undefined) {
            return undefined;
        }
        const val = Object.values(row)[0];
        if (typeof val === "bigint") {
            return Number(val);
        }
        return val;
    }
}
