import BetterSqlite3 from "better-sqlite3";
import {AbstractMetricsStore, METRICS_RETENTION_TICKS} from "@/common/AbstractMetricsStore.js";
import {MetricsRollupRow} from "@/common/MetricsFact.js";

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
            CREATE TABLE IF NOT EXISTS "MetricsFact" (
                metrics_fact_id INTEGER PRIMARY KEY,
                type INTEGER NOT NULL,
                tick INTEGER NOT NULL,
                player_id INTEGER NOT NULL,
                category INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                tag INTEGER NOT NULL
            )
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS "idx_MetricsFact_type_tick"
                ON "MetricsFact" (type, tick)
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS "idx_MetricsFact_player_type_tick"
                ON "MetricsFact" (player_id, type, tick)
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS "idx_MetricsFact_tick"
                ON "MetricsFact" (tick)
        `);

        this._insert = this.db.prepare(`
            INSERT INTO "MetricsFact" (type, tick, player_id, category, amount, tag)
            VALUES (@type, @tick, @player_id, @category, @amount, @tag)
        `);
        this._insertBatch = this.db.transaction(facts => {
            for (const fact of facts) {
                this._insert.run({
                    type: fact.type, tick: fact.tick, player_id: fact.playerId,
                    category: fact.category, amount: fact.amount, tag: fact.tag,
                });
            }
        });

        // CAST needed: better-sqlite3 binds numbers as REAL, and INTEGER/REAL divides without flooring.
        this._queryRollupAllPlayers = this.db.prepare(`
            SELECT
                (tick / CAST(@bucket_ticks AS INTEGER)) * CAST(@bucket_ticks AS INTEGER) AS bucket_tick,
                category, tag, COUNT(*) AS count, SUM(amount) AS sum
            FROM "MetricsFact" INDEXED BY "idx_MetricsFact_type_tick"
            WHERE type = @type AND tick >= @from_tick AND tick <= @to_tick
            GROUP BY bucket_tick, category, tag
            ORDER BY bucket_tick
        `);
        this._queryRollupForPlayer = this.db.prepare(`
            SELECT
                (tick / CAST(@bucket_ticks AS INTEGER)) * CAST(@bucket_ticks AS INTEGER) AS bucket_tick,
                category, tag, COUNT(*) AS count, SUM(amount) AS sum
            FROM "MetricsFact" INDEXED BY "idx_MetricsFact_player_type_tick"
            WHERE player_id = @player_id AND type = @type AND tick >= @from_tick AND tick <= @to_tick
            GROUP BY bucket_tick, category, tag
            ORDER BY bucket_tick
        `);

        this._deleteFactsBefore = this.db.prepare(
            `DELETE FROM "MetricsFact" INDEXED BY "idx_MetricsFact_tick" WHERE tick < @cutoff`,
        );
    }

    /**
     * @param {MetricsFact[]} facts
     * @returns {Promise<void>}
     */
    async recordBatch(facts) {
        if (facts.length === 0) {
            return;
        }
        this._insertBatch(facts);
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
        return rows.map(row => new MetricsRollupRow(row.bucket_tick, row.category, row.tag, row.count, row.sum));
    }

    /**
     * @param {number} latestTick
     * @returns {Promise<void>}
     */
    async pruneTo(latestTick) {
        const cutoff = latestTick - METRICS_RETENTION_TICKS;
        if (cutoff > 0) {
            this._deleteFactsBefore.run({cutoff});
        }
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
