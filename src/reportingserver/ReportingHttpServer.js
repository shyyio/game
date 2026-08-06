import {createHash} from "node:crypto";
import {formatUptime} from "@/common/util.js";
import {GAME_VERSION} from "@/common/constants.js";
import {BUILD_COMMIT, BUILD_DATE} from "@/common/env.js";
import {AbstractHttpServer} from "@/server/AbstractHttpServer.js";

const MESSAGE_MAX_BYTES = 1024;
const STACK_MAX_BYTES = 8192;
const EXTRA_MAX_BYTES = 2048;
const URL_MAX_BYTES = 500;
const BUILD_VERSION_MAX_BYTES = 100;

const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;
const ADMIN_LIST_LIMIT = 200;

const PAGE_STYLE = `<style>
    body {
        margin: 0;
        background: #f4f5f7;
        color: #1c1e21;
        font: 14px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    .page {
        max-width: 1100px;
        margin: 0 auto;
        padding: 32px 24px 64px;
    }
    h1 {
        font-size: 20px;
        margin: 0 0 20px;
    }
    h2 {
        font-size: 15px;
        margin: 28px 0 8px;
    }
    a {
        color: #2a63d6;
        text-decoration: none;
    }
    a:hover {
        text-decoration: underline;
    }
    .back {
        display: inline-block;
        margin-bottom: 16px;
        font-size: 13px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        background: #fff;
        border: 1px solid #dde1e6;
        border-radius: 6px;
        overflow: hidden;
    }
    th, td {
        padding: 10px 12px;
        text-align: left;
        border-bottom: 1px solid #eceff2;
        vertical-align: top;
    }
    th {
        background: #eceff2;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #5b6270;
    }
    tbody tr:hover {
        background: #f7f9fc;
    }
    tbody tr:last-child td {
        border-bottom: none;
    }
    .count-pill {
        display: inline-block;
        min-width: 22px;
        padding: 2px 8px;
        border-radius: 999px;
        background: #e4e9f2;
        color: #334;
        font-weight: 600;
        font-size: 12px;
        text-align: center;
    }
    .timestamp {
        white-space: nowrap;
        color: #5b6270;
        font-size: 13px;
    }
    code {
        font: 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
        background: #eceff2;
        padding: 2px 5px;
        border-radius: 4px;
    }
    pre {
        background: #1c1e21;
        color: #e6e8eb;
        padding: 14px 16px;
        border-radius: 6px;
        overflow-x: auto;
        font: 12.5px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .meta {
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: 16px;
        row-gap: 6px;
        background: #fff;
        border: 1px solid #dde1e6;
        border-radius: 6px;
        padding: 14px 16px;
        margin: 0;
    }
    .meta dt {
        color: #5b6270;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        align-self: center;
    }
    .meta dd {
        margin: 0;
        align-self: center;
        word-break: break-all;
    }
    .empty {
        color: #5b6270;
    }
    .build-badge {
        position: fixed;
        top: 12px;
        left: 16px;
        font: 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
        color: #8a92a1;
        background: #fff;
        border: 1px solid #dde1e6;
        border-radius: 999px;
        padding: 4px 10px;
    }
    .build-badge a {
        color: #4a5164;
    }
</style>`;

const GITHUB_COMMIT_URL = "https://github.com/shyyio/game/commit/";

/**
 * @param {string} isoDate
 * @returns {string} e.g. "Jul 5, 2026"
 */
function formatShortDate(isoDate) {
    return new Date(isoDate).toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"});
}

const BUILD_BADGE = `<div class="build-badge">
    build <a href="${GITHUB_COMMIT_URL}${BUILD_COMMIT}" target="_blank" rel="noopener noreferrer">${BUILD_COMMIT.slice(0, 12)}</a>
    ${BUILD_DATE !== null ? `&middot; ${formatShortDate(BUILD_DATE)}` : ""}
</div>`;

/**
 * reportingserver's HTTP front end: an anonymous, unauthenticated ingest endpoint for client
 * error reports, plus an admin browse UI. The admin routes carry no app-level auth of their
 * own — nginx gates /admin* with auth_basic in front, per deploy/nginx-reporting.conf.
 */
export class ReportingHttpServer extends AbstractHttpServer {

    /**
     * @param {NodeErrorReportStore} store
     * @param {Symbolicator} symbolicator
     */
    constructor(store, symbolicator) {
        super();
        this._store = store;
        this._symbolicator = symbolicator;
        this._startedAtMs = Date.now();
        this._dayBucket = Math.floor(this._startedAtMs / DAY_MS);

        this._app.post("/report", (res, req) => {
            this._onReport(res);
        });
        this._app.options("/*", (res, req) => {
            res.cork(() => {
                res.writeStatus("204 No Content")
                    .writeHeader("Access-Control-Allow-Origin", "*")
                    .writeHeader("Access-Control-Allow-Methods", "POST")
                    .writeHeader("Access-Control-Allow-Headers", "Content-Type")
                    .endWithoutBody();
            });
        });
        this._app.get("/admin", (res, req) => {
            this._onAdminList(res);
        });
        this._app.get("/admin/reports/:id", (res, req) => {
            const errorReportId = Number(req.getParameter(0));
            this._onAdminDetail(res, errorReportId);
        });
        this._app.get("/*", (res, req) => {
            const host = req.getHeader("host");
            const scheme = req.getHeader("x-forwarded-proto") === "https" ? "https" : "http";
            res.writeHeader("Content-Type", "text/plain; charset=utf-8").end(this._infoScreen(host, scheme));
        });
    }

    /**
     * @private
     * @param {object} res
     * @returns {void}
     */
    _onReport(res) {
        res.onAborted(() => {
            res.aborted = true;
        });
        this._readBody(res, body => {
            if (res.aborted) {
                return;
            }
            let payload;
            try {
                payload = JSON.parse(body);
            } catch (error) {
                this._reject(res, "400 Bad Request", "Malformed JSON body", {cors: true});
                return;
            }
            const report = this._validateReport(payload);
            if (report === null) {
                this._reject(res, "400 Bad Request", "Invalid report", {cors: true});
                return;
            }
            const now = Date.now();
            this._rollDayBucket(now);
            const fingerprint = this._fingerprint(report.message, report.stack);
            this._store.recordReport({fingerprint, ...report}, now, DEDUP_WINDOW_MS);
            this._respond(res, {});
        });
    }

    /**
     * @private
     * @param {object} payload
     * @returns {{message: string, stack: string, buildVersion: string, url: string, extra: string|null}|null}
     */
    _validateReport(payload) {
        if (typeof payload !== "object" || payload === null) {
            return null;
        }
        const {message, stack, buildVersion, url, extra} = payload;
        if (!this._isNonEmptyString(message, MESSAGE_MAX_BYTES)) {
            return null;
        }
        if (!this._isNonEmptyString(stack, STACK_MAX_BYTES)) {
            return null;
        }
        if (!this._isNonEmptyString(buildVersion, BUILD_VERSION_MAX_BYTES)) {
            return null;
        }
        if (!this._isNonEmptyString(url, URL_MAX_BYTES)) {
            return null;
        }
        let extraJson = null;
        if (extra !== undefined) {
            extraJson = JSON.stringify(extra);
            if (Buffer.byteLength(extraJson, "utf8") > EXTRA_MAX_BYTES) {
                return null;
            }
        }
        return {message, stack, buildVersion, url, extra: extraJson};
    }

    /**
     * @private
     * @param {*} value
     * @param {number} maxBytes
     * @returns {boolean}
     */
    _isNonEmptyString(value, maxBytes) {
        return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= maxBytes;
    }

    /**
     * Fingerprints on the message plus the first 3 "at ..." frames, so the same crash from
     * different call sites (or with a shifting line number across builds) still dedupes.
     * @private
     * @param {string} message
     * @param {string} stack
     * @returns {string}
     */
    _fingerprint(message, stack) {
        const frames = stack.split("\n").filter(line => line.trim().startsWith("at")).slice(0, 3).join("\n");
        return createHash("sha1").update(message).update("\n").update(frames).digest("hex");
    }

    /**
     * Prunes rows past retention on UTC day rollover — runs at most once per day, not on
     * every request.
     * @private
     * @param {number} nowMs
     * @returns {void}
     */
    _rollDayBucket(nowMs) {
        const today = Math.floor(nowMs / DAY_MS);
        if (today === this._dayBucket) {
            return;
        }
        this._dayBucket = today;
        this._store.prune(nowMs - RETENTION_MS);
    }

    /**
     * @private
     * @param {object} res
     * @returns {void}
     */
    _onAdminList(res) {
        const rows = this._store.listGrouped(ADMIN_LIST_LIMIT);
        res.writeHeader("Content-Type", "text/html; charset=utf-8").end(this._renderList(rows));
    }

    /**
     * @private
     * @param {object} res
     * @param {number} errorReportId
     * @returns {void}
     */
    _onAdminDetail(res, errorReportId) {
        res.onAborted(() => {
            res.aborted = true;
        });
        const report = this._store.getById(errorReportId);
        if (report === undefined) {
            this._reject(res, "404 Not Found", "No such report");
            return;
        }
        if (report.resolved_stack !== null) {
            res.cork(() => {
                res.writeHeader("Content-Type", "text/html; charset=utf-8").end(this._renderDetail(report, report.resolved_stack));
            });
            return;
        }
        this._symbolicator.resolve(report.build_version, report.stack).then(resolvedStack => {
            if (res.aborted) {
                return;
            }
            if (resolvedStack !== null) {
                this._store.setResolvedStack(errorReportId, resolvedStack);
            }
            res.cork(() => {
                res.writeHeader("Content-Type", "text/html; charset=utf-8").end(this._renderDetail(report, resolvedStack || report.stack));
            });
        }).catch(error => {
            if (res.aborted) {
                return;
            }
            res.cork(() => {
                res.writeHeader("Content-Type", "text/html; charset=utf-8").end(this._renderDetail(report, report.stack));
            });
        });
    }

    /**
     * @private
     * @param {Array<object>} rows
     * @returns {string}
     */
    _renderList(rows) {
        const items = rows.map(row => `
            <tr>
                <td><span class="count-pill">${row.count}</span></td>
                <td class="timestamp">${this._formatTimestamp(row.last_seen)}</td>
                <td class="timestamp">${this._formatTimestamp(row.first_seen)}</td>
                <td>${this._buildLink(row.build_version)}</td>
                <td><a href="/admin/reports/${row.error_report_id}">${escapeHtml(row.message)}</a></td>
            </tr>
        `).join("");
        const body = rows.length === 0
            ? `<p class="empty">No reports yet.</p>`
            : `<table>
<thead><tr><th>Count</th><th>Last seen</th><th>First seen</th><th>Build</th><th>Message</th></tr></thead>
<tbody>${items}</tbody>
</table>`;
        return this._page("reportingserver", `<h1>Error reports</h1>\n${body}`);
    }

    /**
     * @private
     * @param {object} report
     * @param {string} stack
     * @returns {string}
     */
    _renderDetail(report, stack) {
        const extra = report.extra !== null
            ? `<h2>Extra</h2><pre>${escapeHtml(report.extra)}</pre>`
            : "";
        const body = `<a class="back" href="/admin">&laquo; all reports</a>
<h1>${escapeHtml(report.message)}</h1>
<dl class="meta">
    <dt>Count</dt><dd><span class="count-pill">${report.count}</span></dd>
    <dt>First seen</dt><dd class="timestamp">${this._formatTimestamp(report.first_seen)}</dd>
    <dt>Last seen</dt><dd class="timestamp">${this._formatTimestamp(report.last_seen)}</dd>
    <dt>Build</dt><dd>${this._buildLink(report.build_version)}</dd>
    <dt>URL</dt><dd><code>${escapeHtml(report.url)}</code></dd>
</dl>
<h2>Stack</h2>
<pre>${escapeHtml(stack)}</pre>
${extra}`;
        return this._page(`reportingserver — report ${report.error_report_id}`, body);
    }

    /**
     * @private
     * @param {string} title
     * @param {string} bodyHtml
     * @returns {string}
     */
    _page(title, bodyHtml) {
        return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>${PAGE_STYLE}</head>
<body>
${BUILD_BADGE}
<div class="page">
${bodyHtml}
</div>
</body></html>`;
    }

    /**
     * @private
     * @param {number} ms
     * @returns {string}
     */
    _formatTimestamp(ms) {
        const formatted = new Date(ms).toLocaleString("en-US", {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
        });
        return `${formatted} UTC`;
    }

    /**
     * A report's build_version linked to its GitHub commit. No commit-date lookup here — that
     * would mean shelling out to git per unique build_version on every admin page load.
     * @private
     * @param {string} commitHash
     * @returns {string}
     */
    _buildLink(commitHash) {
        return `<a href="${GITHUB_COMMIT_URL}${encodeURIComponent(commitHash)}" target="_blank" rel="noopener noreferrer">${escapeHtml(commitHash.slice(0, 12))}</a>`;
    }

    /**
     * @private
     * @param {string} host
     * @param {string} scheme
     * @returns {string}
     */
    _infoScreen(host, scheme) {
        const uptime = formatUptime(this._startedAtMs);
        return this._infoScreenBanner("Reporting Server", [
            `  version    : ${GAME_VERSION}`,
            `  http       : ${scheme}://${host}`,
            `  uptime     : ${uptime}`,
        ]);
    }

}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
