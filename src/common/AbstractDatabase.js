import {NotImplementedError} from "@/common/error.js";
import {DEV} from "@/common/env.js";

/**
 * Number of most-recent durations retained per statement; older entries are dropped.
 * @type {number}
 */
const PROFILING_HISTORY = 10000;

/**
 * Result columns whose values must stay BigInt (the rest are narrowed by {@link formatRow}).
 * @type {Set<string>}
 */
export const BIGINT_COLS = new Set([
    "id",
    "parent_id",
    "belt_id",
    "path_id",
    "head",
    "tail_id",
    // Port ids — BigInt to match the id carried by port events.
    "in_port_id",
    "out_port_id",
    "in_id",
    "out_id",
    "out_a_id",
    "out_b_id",
    // Belt/path id aliases from GetBeltCreateContext; kept BigInt so id comparisons
    // (e.g. child_id vs head, child_path vs child_id) don't mismatch BigInt vs Number.
    "child_id",
    "child_path",
    "child_old_parent",
    "old_parent_path_head",
]);

/**
 * Narrows BigInt values to Number for all columns not listed in {@link BIGINT_COLS},
 * mutating and returning the row.
 * @param {object} row
 * @returns {object}
 */
export function formatRow(row) {
    Object.entries(row).forEach(([key, value]) => {
        if (!BIGINT_COLS.has(key) && typeof value === "bigint") {
            row[key] = Number(value);
        }
    });
    return row;
}

/**
 * @abstract
 */
export class AbstractDatabase {

    /**
     * @param {DatabaseSchema} schema
     */
    constructor(schema) {
        this.schema = schema;
        this.statements = {};

        // Per-statement-name list of execution durations (ms); see profilingSummary.
        this.profilingData = {};
    }

    /**
     * @abstract
     * @returns {Promise<void>}
     */
    async init() {
        throw new NotImplementedError();
    }

    /**
     * Runs each mod's temp schema then prepares every statement, seeding profiling.
     * @protected
     * @returns {void}
     */
    _postInit() {
        this.schema.tempSchema.forEach(sql => this.rawExec(sql));

        Object.entries(this.schema.preparedStatements).forEach(([name, sql]) => {
            try {
                this.statements[name] = this._prepareStatement(sql);
            } catch (e) {
                console.error(`Failed to prepare statement "${name}":`, e.message);
                throw e;
            }

            this.profilingData[name] = [];
        });
    }

    /**
     * @abstract
     * @param {string} sql
     * @returns {*} the backend's prepared-statement handle
     */
    _prepareStatement(sql) {
        throw new NotImplementedError();
    }

    /**
     * @abstract
     * @param {string} sql
     * @returns {void}
     */
    rawExec(sql) {
        throw new NotImplementedError();
    }

    /**
     * Converts a plain args object into the @-prefixed format expected by sql.js,
     * serializing BigInt values to strings.
     * @param {object} args
     * @returns {object}
     */
    formatArgs(args) {
        if (args === undefined) {
            return {};
        }
        const result = {};
        Object.entries(args).forEach(([key, value]) => {
            result[`@${key}`] = typeof value === "bigint" ? value.toString() : value;
        });
        return result;
    }

    begin() {
        this.exec("Begin");
    }

    rollback() {
        this.exec("Rollback");
    }

    end() {
        this.exec("End");
    }

    /**
     * @private
     * @param {string} name
     * @returns {*} the backend's prepared-statement handle
     */
    _resolveStatement(name) {
        const stmt = this.statements[name];

        if (stmt === undefined) {
            throw new Error(`Unknown prepared statement: ${name}`);
        }

        return stmt;
    }

    /**
     * @param {string} name
     * @param [args] {*}
     * @returns {number}
     */
    exec(name, args) {
        const stmt = this._resolveStatement(name);

        if (this.debug) {
            console.log(name + (args ? " " + JSON.stringify(args) : ""));
        }

        if (!DEV) {
            return this._exec(stmt, args);
        }

        const startTime = performance.now();
        const changes = this._exec(stmt, args);
        this._recordProfiling(name, performance.now() - startTime);

        return changes;
    }

    /**
     * @param {string} name
     * @param [args] {*}
     * @returns {*[]}
     */
    query(name, args) {
        const stmt = this._resolveStatement(name);

        if (this.debug) {
            console.log(name + (args ? " " + JSON.stringify(args) : "") + " ?");
        }

        if (!DEV) {
            return this._query(stmt, args);
        }

        const startTime = performance.now();
        const result = this._query(stmt, args);
        this._recordProfiling(name, performance.now() - startTime);

        return result;
    }

    /**
     * Appends a duration to a statement's rolling history, evicting the oldest past the cap.
     * @private
     * @param {string} name
     * @param {number} duration
     * @returns {void}
     */
    _recordProfiling(name, duration) {
        const history = this.profilingData[name];
        history.push(duration);

        if (history.length > PROFILING_HISTORY) {
            history.shift();
        }
    }

    /**
     * @abstract
     * @param {*} stmt the backend's prepared-statement handle
     * @param [args] {*}
     * @returns {number} rows modified
     */
    _exec(stmt, args) {
        throw new NotImplementedError();
    }

    /**
     * @abstract
     * @param {*} stmt the backend's prepared-statement handle
     * @param [args] {*}
     * @returns {*[]}
     */
    _query(stmt, args) {
        throw new NotImplementedError();
    }

    /**
     * Aggregates the rolling per-statement timings (ms) for every statement, sorted by
     * total descending; profiling only (empty outside the DEV build).
     * @returns {{name: string, count: number, total: number, mean: number}[]}
     */
    profilingSummary() {
        const rows = [];

        Object.entries(this.profilingData).forEach(([name, durations]) => {
            const total = durations.reduce((sum, duration) => sum + duration, 0);

            rows.push({
                name: name,
                count: durations.length,
                total: total,
                mean: durations.length === 0 ? 0 : total / durations.length
            });
        });

        rows.sort((a, b) => b.total - a.total);

        return rows;
    }

    /**
     * Discards all collected timings; call before a measured run to drop warm-up noise.
     * @returns {void}
     */
    resetProfiling() {
        Object.keys(this.profilingData).forEach(name => {
            this.profilingData[name] = [];
        });
    }

    /**
     * @param name {string}
     * @param [args] {*}
     * @returns {*}
     */
    querySingle(name, args) {
        const result = this.query(name, args);

        if (result.length === 0) {
            return null;
        }

        return result[0];
    }

    /**
     * @param name {string}
     * @param [args] {*}
     * @returns {*}
     */
    queryScalar(name, args) {
        const result = this.query(name, args);

        if (result.length === 0) {
            return null;
        }

        return Object.values(result[0])[0];
    }
}