import {USERNAME_PATTERN} from "@/common/constants.js";

export class AccountEntry {

    /**
     * @param {number} accountId
     * @param {string} username
     * @param {number} createdAt
     */
    constructor(accountId, username, createdAt) {
        this.accountId = accountId;
        this.username = username;
        this.createdAt = createdAt;
    }

    /**
     * @param {{account_id: number, username: string, created_at: number}} row
     * @returns {AccountEntry}
     */
    static parse(row) {
        return new AccountEntry(row.account_id, row.username, row.created_at);
    }
}

/**
 * The account roster backing dummy username-only login; getOrCreate is the seam Steam OpenID
 * replaces later.
 */
export class AccountRegistry {

    /**
     * @param {NodeAccountStore} store
     */
    constructor(store) {
        this._store = store;
    }

    /**
     * The account named `username`, registered on first sight.
     * @param {string} username
     * @returns {AccountEntry}
     */
    getOrCreate(username) {
        if (!USERNAME_PATTERN.test(username)) {
            throw new RangeError(`Invalid username: ${JSON.stringify(username)}`);
        }
        const existing = this._store.findByUsername(username);
        if (existing !== undefined) {
            return AccountEntry.parse(existing);
        }
        const createdAt = Date.now();
        const accountId = this._store.insert(username, createdAt);
        return new AccountEntry(accountId, username, createdAt);
    }

    /**
     * @param {number} accountId
     * @returns {AccountEntry}
     */
    getPlayerByRef(accountId) {
        const row = this._store.findById(accountId);
        if (row === undefined) {
            throw new RangeError(`Unknown accountId: ${accountId}`);
        }
        return AccountEntry.parse(row);
    }
}
