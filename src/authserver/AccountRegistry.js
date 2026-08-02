import {USERNAME_PATTERN} from "@/common/constants.js";

export class AccountRecord {

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
     * @returns {AccountRecord}
     */
    getOrCreate(username) {
        if (!USERNAME_PATTERN.test(username)) {
            throw new RangeError(`Invalid username: ${JSON.stringify(username)}`);
        }
        const existing = this._store.findByUsername(username);
        if (existing !== undefined) {
            return toRecord(existing);
        }
        const createdAt = Date.now();
        const accountId = this._store.insert(username, createdAt);
        return new AccountRecord(accountId, username, createdAt);
    }

    /**
     * @param {number} accountId
     * @returns {AccountRecord}
     */
    byId(accountId) {
        const row = this._store.findById(accountId);
        if (row === undefined) {
            throw new RangeError(`Unknown accountId: ${accountId}`);
        }
        return toRecord(row);
    }
}

/**
 * @param {{account_id: number, username: string, created_at: number}} row
 * @returns {AccountRecord}
 */
function toRecord(row) {
    return new AccountRecord(row.account_id, row.username, row.created_at);
}
