import BetterSqlite3 from "better-sqlite3";
import {AbstractDatabase} from "@/common/AbstractDatabase.js";

export class NodeDatabase extends AbstractDatabase {

    constructor(schema) {
        super(schema);
        this.db = null;
    }

    async init() {
        this.db = new BetterSqlite3(":memory:");
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
            result[key] = value;
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
        return stmt.all(this.formatArgs(args));
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
        return Object.values(row)[0];
    }

    /**
     * Returns the live database schema as one SQL string: every persistent object's
     * DDL followed by the temporary ones (temp tables/indexes live in a separate
     * sqlite_temp_master and would be missed by a plain sqlite_master dump). Each
     * source is read in creation order; rows with NULL sql (auto-created indexes)
     * and SQLite's own bookkeeping objects (sqlite_sequence, etc.) are skipped.
     * Node/CLI debugging only.
     * @returns {string}
     */
    dumpSchema() {
        const dumpSource = source => this.db
            .prepare(`SELECT sql FROM ${source} WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`)
            .all()
            .map(row => row.sql + ";")
            .join("\n\n");

        return `${dumpSource("sqlite_master")}\n\n-- Temporary tables\n\n${dumpSource("sqlite_temp_master")}\n`;
    }
}
