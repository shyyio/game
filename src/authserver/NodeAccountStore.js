import BetterSqlite3 from "better-sqlite3";

/**
 * Node account persistence: one row per account, keyed by username for now (the seam a
 * Steam-SSO lookup replaces later).
 */
export class NodeAccountStore {

    /**
     * @param {string} [path] - SQLite file, or ":memory:" for an in-process store
     */
    constructor(path=":memory:") {
        this.db = new BetterSqlite3(path);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "Account" (
                account_id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL
            )
        `);
        this._findByUsername = this.db.prepare("SELECT account_id, username, created_at FROM \"Account\" WHERE username = ?");
        this._findById = this.db.prepare("SELECT account_id, username, created_at FROM \"Account\" WHERE account_id = ?");
        this._insert = this.db.prepare("INSERT INTO \"Account\" (username, created_at) VALUES (?, ?)");
    }

    /**
     * @param {string} username
     * @returns {{account_id: number, username: string, created_at: number}|undefined}
     */
    findByUsername(username) {
        return this._findByUsername.get(username);
    }

    /**
     * @param {number} accountId
     * @returns {{account_id: number, username: string, created_at: number}|undefined}
     */
    findById(accountId) {
        return this._findById.get(accountId);
    }

    /**
     * @param {string} username
     * @param {number} createdAt
     * @returns {number} the new account_id
     */
    insert(username, createdAt) {
        return this._insert.run(username, createdAt).lastInsertRowid;
    }
}
