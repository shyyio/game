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

    }

    /**
     * @abstract
     * @param {string} name
     * @param [args] {*}
     * @returns {*[]}
     */
    query(name, args) {

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