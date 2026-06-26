import BetterSqlite3 from "better-sqlite3";
import {AbstractDatabase, formatRow} from "@/common/AbstractDatabase.js";

export class NodeDatabase extends AbstractDatabase {

    constructor(schema) {
        super(schema);
        this.db = null;
    }

    async init() {
        this.db = new BetterSqlite3(":memory:");
        this.db.defaultSafeIntegers(true);
        this.schema.pragma.forEach(sql => this.db.exec(sql));
        this.schema.initSchema.forEach(sql => this.db.exec(sql));
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

    /**
     * @protected
     * @param {*} stmt
     * @param [args] {*}
     * @returns {number}
     */
    _exec(stmt, args) {
        const info = stmt.run(this.formatArgs(args));
        return info.changes;
    }

    /**
     * @protected
     * @param {*} stmt
     * @param [args] {*}
     * @returns {*[]}
     */
    _query(stmt, args) {
        const rows = stmt.all(this.formatArgs(args));
        return rows.map(formatRow);
    }

    /**
     * Executes raw SQL ignoring result rows; tests only.
     * @param {string} sql
     */
    rawExec(sql) {
        this.db.exec(sql);
    }

    /**
     * Runs raw SQL and returns the first column of the first row (or undefined); tests only.
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
