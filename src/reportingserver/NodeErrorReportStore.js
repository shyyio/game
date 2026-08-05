import BetterSqlite3 from "better-sqlite3";

/**
 * Node persistence for anonymous client error reports. Rows are deduplicated by fingerprint
 * within a time window (recordReport bumps count/last_seen instead of inserting a duplicate),
 * so a crash loop grows one row's counter rather than the table.
 */
export class NodeErrorReportStore {

    /**
     * @param {string} [path] - SQLite file, or ":memory:" for an in-process store
     */
    constructor(path=":memory:") {
        this.db = new BetterSqlite3(path);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "ErrorReport" (
                error_report_id INTEGER PRIMARY KEY,
                fingerprint TEXT NOT NULL,
                message TEXT NOT NULL,
                stack TEXT NOT NULL,
                resolved_stack TEXT,
                build_version TEXT NOT NULL,
                url TEXT NOT NULL,
                extra TEXT,
                count INTEGER NOT NULL,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL
            )
        `);
        this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_ErrorReport_fingerprint" ON "ErrorReport" (fingerprint)`);

        this._findRecentByFingerprint = this.db.prepare(`
            SELECT error_report_id
            FROM "ErrorReport"
            WHERE fingerprint = ? AND last_seen >= ?
            ORDER BY last_seen DESC
            LIMIT 1
        `);
        this._bump = this.db.prepare(`UPDATE "ErrorReport" SET count = count + 1, last_seen = ? WHERE error_report_id = ?`);
        this._insert = this.db.prepare(`
            INSERT INTO "ErrorReport" (fingerprint, message, stack, build_version, url, extra, count, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `);
        this._prune = this.db.prepare(`DELETE FROM "ErrorReport" WHERE last_seen < ?`);
        this._listGrouped = this.db.prepare(`
            SELECT error_report_id, fingerprint, message, build_version, url, count, first_seen, last_seen
            FROM "ErrorReport"
            ORDER BY last_seen DESC
            LIMIT ?
        `);
        this._getById = this.db.prepare(`
            SELECT error_report_id, fingerprint, message, stack, resolved_stack, build_version, url, extra, count, first_seen, last_seen
            FROM "ErrorReport"
            WHERE error_report_id = ?
        `);
        this._setResolvedStack = this.db.prepare(`UPDATE "ErrorReport" SET resolved_stack = ? WHERE error_report_id = ?`);
    }

    /**
     * Bumps the matching row's count/last_seen if the same fingerprint was seen within
     * dedupWindowMs, otherwise inserts a new row.
     * @param {{fingerprint: string, message: string, stack: string, buildVersion: string, url: string, extra: string|null}} report
     * @param {number} nowMs
     * @param {number} dedupWindowMs
     * @returns {{errorReportId: number, isNew: boolean}}
     */
    recordReport(report, nowMs, dedupWindowMs) {
        const {fingerprint, message, stack, buildVersion, url, extra} = report;
        const recent = this._findRecentByFingerprint.get(fingerprint, nowMs - dedupWindowMs);
        if (recent !== undefined) {
            this._bump.run(nowMs, recent.error_report_id);
            return {errorReportId: recent.error_report_id, isNew: false};
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
