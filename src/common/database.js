import {NotImplementedError} from "@/common/error.js";

/**
 * Result columns whose values must stay BigInt. Every other BigInt-valued column
 * is narrowed to Number by {@link formatRow}. Shared by both backends.
 * @type {Set<string>}
 */
export const BIGINT_COLS = new Set(["id", "parent_id", "belt_id", "path_id", "head", "tail_id"]);

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
export class Database {

    /**
     * @param {DatabaseSchema} schema
     */
    constructor(schema) {
        this.schema = schema;
    }

    /**
     * @abstract
     */
    async init() {
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
     * @abstract
     * @param {string} name
     * @param [args] {*}
     * @returns {number}
     */
    exec(name, args) {
        throw new NotImplementedError();
    }

    /**
     * @abstract
     * @param {string} name
     * @param [args] {*}
     * @returns {*[]}
     */
    query(name, args) {
        throw new NotImplementedError();
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