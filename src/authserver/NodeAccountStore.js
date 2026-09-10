import BetterSqlite3 from "better-sqlite3";

const BUSY_TIMEOUT_MS = 5000;

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
        // Readers (the backup's VACUUM INTO) never block a login's INSERT.
        this.db.pragma("journal_mode = WAL");
        this.db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "Account" (
                accountId INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                createdAt INTEGER NOT NULL
            )
        `);
        this._findByUsername = this.db.prepare("SELECT accountId, username, createdAt FROM \"Account\" WHERE username = ?");
        this._findById = this.db.prepare("SELECT accountId, username, createdAt FROM \"Account\" WHERE accountId = ?");
        this._insert = this.db.prepare("INSERT INTO \"Account\" (username, createdAt) VALUES (?, ?)");
    }

    /**
     * @param {string} username
     * @returns {{accountId: number, username: string, createdAt: number}|undefined}
     */
    findByUsername(username) {
        return this._findByUsername.get(username);
    }

    /**
     * @param {number} accountId
     * @returns {{accountId: number, username: string, createdAt: number}|undefined}
     */
    findById(accountId) {
        return this._findById.get(accountId);
    }

    /**
     * @param {string} username
     * @param {number} createdAt
     * @returns {number} the new accountId
     */
    insert(username, createdAt) {
        return this._insert.run(username, createdAt).lastInsertRowid;
    }
}
