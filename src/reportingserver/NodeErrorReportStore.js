import BetterSqlite3 from "better-sqlite3";

/**
 * @typedef {Object} ReportReceipt
 * @property {number} errorReportId
 * @property {boolean} isNew false when the report bumped an existing row
 */

/**
 * Node persistence for anonymous client error reports. Rows are deduplicated by fingerprint
 * within a time window (putReport bumps count/lastSeen), so a crash loop grows one row's
 * counter.
 */
export class NodeErrorReportStore {

    /**
     * @param {string} [path] - SQLite file, or ":memory:" for an in-process store
     */
    constructor(path=":memory:") {
        this.db = new BetterSqlite3(path);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "ErrorReport" (
                errorReportId INTEGER PRIMARY KEY,
                fingerprint TEXT NOT NULL,
                message TEXT NOT NULL,
                stack TEXT NOT NULL,
                resolvedStack TEXT,
                buildVersion TEXT NOT NULL,
                url TEXT NOT NULL,
                extra TEXT,
                count INTEGER NOT NULL,
                firstSeen INTEGER NOT NULL,
                lastSeen INTEGER NOT NULL
            )
        `);
        this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_ErrorReport_fingerprint" ON "ErrorReport" (fingerprint)`);

        this._selectRecentByFingerprint = this.db.prepare(`
            SELECT errorReportId
            FROM "ErrorReport"
            WHERE fingerprint = ? AND lastSeen >= ?
            ORDER BY lastSeen DESC
            LIMIT 1
        `);
        this._bump = this.db.prepare(`UPDATE "ErrorReport" SET count = count + 1, lastSeen = ? WHERE errorReportId = ?`);
        this._insert = this.db.prepare(`
            INSERT INTO "ErrorReport" (fingerprint, message, stack, buildVersion, url, extra, count, firstSeen, lastSeen)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `);
        this._prune = this.db.prepare(`DELETE FROM "ErrorReport" WHERE lastSeen < ?`);
        this._listGrouped = this.db.prepare(`
            SELECT errorReportId, fingerprint, message, buildVersion, url, count, firstSeen, lastSeen
            FROM "ErrorReport"
            ORDER BY lastSeen DESC
            LIMIT ?
        `);
        this._getById = this.db.prepare(`
            SELECT errorReportId, fingerprint, message, stack, resolvedStack, buildVersion, url, extra, count, firstSeen, lastSeen
            FROM "ErrorReport"
            WHERE errorReportId = ?
        `);
        this._setResolvedStack = this.db.prepare(`UPDATE "ErrorReport" SET resolvedStack = ? WHERE errorReportId = ?`);
    }

    /**
     * Bumps the matching row's count/lastSeen if the same fingerprint was seen within
     * dedupWindowMs, otherwise inserts a new row.
     * @param {{fingerprint: string, message: string, stack: string, buildVersion: string, url: string, extra: string|null}} report
     * @param {number} nowMs
     * @param {number} dedupWindowMs
     * @returns {ReportReceipt}
     */
    putReport(report, nowMs, dedupWindowMs) {
        const {fingerprint, message, stack, buildVersion, url, extra} = report;
        const recent = this._selectRecentByFingerprint.get(fingerprint, nowMs - dedupWindowMs);
        if (recent !== undefined) {
            this._bump.run(nowMs, recent.errorReportId);
            return {errorReportId: recent.errorReportId, isNew: false};
        }
        const errorReportId = this._insert.run(fingerprint, message, stack, buildVersion, url, extra, nowMs, nowMs).lastInsertRowid;
        return {errorReportId, isNew: true};
    }

    /**
     * @param {number} beforeMs
     * @returns {void}
     */
    prune(beforeMs) {
        this._prune.run(beforeMs);
    }

    /**
     * @param {number} limit
     * @returns {Array<object>}
     */
    listGrouped(limit) {
        return this._listGrouped.all(limit);
    }

    /**
     * @param {number} errorReportId
     * @returns {object|undefined}
     */
    getById(errorReportId) {
        return this._getById.get(errorReportId);
    }

    /**
     * @param {number} errorReportId
     * @param {string} resolvedStack
     * @returns {void}
     */
    setResolvedStack(errorReportId, resolvedStack) {
        this._setResolvedStack.run(resolvedStack, errorReportId);
    }
}
