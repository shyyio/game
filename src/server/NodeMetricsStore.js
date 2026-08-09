import BetterSqlite3 from "better-sqlite3";
import {AbstractMetricsStore, METRICS_RETENTION_TICKS} from "@/common/AbstractMetricsStore.js";
import {MetricsEvent, MetricsRollupRow} from "@/common/MetricsEvent.js";

/**
 * Node {@link AbstractMetricsStore}: SQLite-backed, WAL mode, bounded by METRICS_RETENTION_TICKS.
 */
export class NodeMetricsStore extends AbstractMetricsStore {

    /**
     * @param {string} [path] - SQLite file, or ":memory:" for an in-process store
     */
    constructor(path=":memory:") {
        super();
        this.db = new BetterSqlite3(path);
        this.db.pragma("journal_mode = WAL");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "MetricsEvent" (
                metrics_event_id INTEGER PRIMARY KEY,
                type INTEGER NOT NULL,
                tick INTEGER NOT NULL,
                player_id INTEGER NOT NULL,
                category INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                tag INTEGER NOT NULL
            )
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS "idx_MetricsEvent_type_tick"
                ON "MetricsEvent" (type, tick)
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS "idx_MetricsEvent_player_type_tick"
                ON "MetricsEvent" (player_id, type, tick)
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS "idx_MetricsEvent_tick"
                ON "MetricsEvent" (tick)
        `);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "Tick" (
                tick INTEGER PRIMARY KEY,
                timestamp INTEGER NOT NULL
            )
        `);

        this._insert = this.db.prepare(`
            INSERT INTO "MetricsEvent" (type, tick, player_id, category, amount, tag)
            VALUES (@type, @tick, @player_id, @category, @amount, @tag)
        `);
        this._insertBatch = this.db.transaction(events => {
            for (const event of events) {
                this._insert.run({
                    type: event.type, tick: event.tick, player_id: event.playerId,
                    category: event.category, amount: event.amount, tag: event.tag,
                });
            }
        });

        this._queryRangeAllPlayers = this.db.prepare(`
            SELECT type, tick, player_id, category, amount, tag
            FROM "MetricsEvent" INDEXED BY "idx_MetricsEvent_type_tick"
            WHERE type = @type AND tick >= @from_tick AND tick <= @to_tick
            ORDER BY tick
        `);
        this._queryRangeForPlayer = this.db.prepare(`
            SELECT type, tick, player_id, category, amount, tag
            FROM "MetricsEvent" INDEXED BY "idx_MetricsEvent_player_type_tick"
            WHERE player_id = @player_id AND type = @type AND tick >= @from_tick AND tick <= @to_tick
            ORDER BY tick
        `);

        // CAST needed: better-sqlite3 binds numbers as REAL, and INTEGER/REAL divides without flooring.
        this._queryRollupAllPlayers = this.db.prepare(`
            SELECT
                (tick / CAST(@bucket_ticks AS INTEGER)) * CAST(@bucket_ticks AS INTEGER) AS bucket_tick,
                category, tag, COUNT(*) AS count, SUM(amount) AS sum
            FROM "MetricsEvent" INDEXED BY "idx_MetricsEvent_type_tick"
            WHERE type = @type AND tick >= @from_tick AND tick <= @to_tick
            GROUP BY bucket_tick, category, tag
            ORDER BY bucket_tick
        `);
        this._queryRollupForPlayer = this.db.prepare(`
            SELECT
                (tick / CAST(@bucket_ticks AS INTEGER)) * CAST(@bucket_ticks AS INTEGER) AS bucket_tick,
                category, tag, COUNT(*) AS count, SUM(amount) AS sum
            FROM "MetricsEvent" INDEXED BY "idx_MetricsEvent_player_type_tick"
            WHERE player_id = @player_id AND type = @type AND tick >= @from_tick AND tick <= @to_tick
            GROUP BY bucket_tick, category, tag
            ORDER BY bucket_tick
        `);

        this._insertTick = this.db.prepare(
            `INSERT OR IGNORE INTO "Tick" (tick, timestamp) VALUES (@tick, @timestamp)`,
        );
        this._insertTicks = this.db.transaction(ticks => {
            for (const entry of ticks) {
                this._insertTick.run({tick: entry.tick, timestamp: entry.timestamp});
            }
        });
        this._queryTickTimestamps = this.db.prepare(`
            SELECT tick, timestamp FROM "Tick" WHERE tick >= @from_tick AND tick <= @to_tick ORDER BY tick
        `);

        this._deleteEventsBefore = this.db.prepare(
            `DELETE FROM "MetricsEvent" INDEXED BY "idx_MetricsEvent_tick" WHERE tick < @cutoff`,
        );
        this._deleteTicksBefore = this.db.prepare(`DELETE FROM "Tick" WHERE tick < @cutoff`);
        this._prune = this.db.transaction(cutoff => {
            this._deleteEventsBefore.run({cutoff});
            this._deleteTicksBefore.run({cutoff});
        });
    }

    /**
     * @param {MetricsEvent[]} events
     * @returns {Promise<void>}
     */
    async recordBatch(events) {
        if (events.length === 0) {
            return;
        }
        this._insertBatch(events);
    }

    /**
     * @param {number} type
     * @param {number|null} playerId
     * @param {number} fromTick
     * @param {number} toTick
     * @returns {Promise<MetricsEvent[]>}
     */
    async queryRange(type, playerId, fromTick, toTick) {
        let rows;
        if (playerId === null) {
            rows = this._queryRangeAllPlayers.all({type, from_tick: fromTick, to_tick: toTick});
        } else {
            rows = this._queryRangeForPlayer.all({player_id: playerId, type, from_tick: fromTick, to_tick: toTick});
        }
        return rows.map(row => new MetricsEvent(row.type, row.tick, row.player_id, row.category, row.amount, row.tag));
    }

    /**
     * @param {number} type
     * @param {number|null} playerId
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} bucketTicks
     * @returns {Promise<MetricsRollupRow[]>}
     */
    async queryRollup(type, playerId, fromTick, toTick, bucketTicks) {
        let rows;
        if (playerId === null) {
            rows = this._queryRollupAllPlayers.all({bucket_ticks: bucketTicks, type, from_tick: fromTick, to_tick: toTick});
        } else {
            rows = this._queryRollupForPlayer.all({
                bucket_ticks: bucketTicks, player_id: playerId, type, from_tick: fromTick, to_tick: toTick,
            });
        }
        return rows.map(MetricsRollupRow.fromSqlRow);
    }

    /**
     * @param {{tick: number, timestamp: number}[]} ticks
     * @returns {Promise<void>}
     */
    async recordTicks(ticks) {
        if (ticks.length === 0) {
            return;
        }
        this._insertTicks(ticks);
        const latestTick = ticks[ticks.length - 1].tick;
        const cutoff = latestTick - METRICS_RETENTION_TICKS;
        if (cutoff > 0) {
            this._prune(cutoff);
        }
    }

    /**
     * @param {number} fromTick
     * @param {number} toTick
     * @returns {Promise<{tick: number, timestamp: number}[]>}
     */
    async queryTickTimestamps(fromTick, toTick) {
        return this._queryTickTimestamps.all({from_tick: fromTick, to_tick: toTick});
    }

    /**
     * Checkpoints the WAL into the main file and closes the connection.
     * @returns {Promise<void>}
     */
    async close() {
        this.db.pragma("wal_checkpoint(TRUNCATE)");
        this.db.close();
    }
}
