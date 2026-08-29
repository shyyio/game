import BetterSqlite3 from "better-sqlite3";
import {AbstractMetricsStore, METRICS_RETENTION_TICKS} from "@/common/AbstractMetricsStore.js";
import {MetricsRollupRow} from "@/common/MetricsFact.js";
import {
    bucketTickFor, METRICS_BAKED_TIERS, METRICS_COARSE_TIERS, METRICS_FOLD_TIER,
} from "@/common/MetricsTiers.js";

// Backfill folds at most this many ticks per transaction, to bound the WAL.
const FOLD_CHUNK_TICKS = 100 * METRICS_FOLD_TIER;

// Bump when a fold's meaning changes; a file baked by another version is rebuilt from its facts.
const BUCKET_FORMAT_VERSION = 1;

/**
 * SQL flooring `column` to its bucket start, for a statement binding `@tier`. CAST because
 * better-sqlite3 binds numbers as REAL, and INTEGER/REAL divides without flooring.
 * @param {string} column
 * @returns {string}
 */
function bucketFloor(column) {
    return `(${column} / CAST(@tier AS INTEGER)) * CAST(@tier AS INTEGER)`;
}

/**
 * Rollup of one type over pre-baked buckets plus the facts recorded since the last fold. An
 * un-baked tier matches no bucket rows, leaving a pure fact query.
 * @param {string} playerPredicate - WHERE term scoping both halves to one player, or ""
 * @param {string} bucketIndex - INDEXED BY clause for the bucket half, or "" to walk it in key order
 * @returns {string}
 */
function rollupSql(playerPredicate, bucketIndex) {
    return `
        SELECT bucket_tick, category, tag, SUM(count) AS count, SUM(sum) AS sum
        FROM (
            SELECT bucket_tick, category, tag, count, sum
            FROM "MetricsBucket" ${bucketIndex}
            WHERE tier = @tier AND type = @type${playerPredicate}
                AND bucket_tick >= @from_bucket AND bucket_tick <= @to_tick
            UNION ALL
            SELECT
                ${bucketFloor("tick")} AS bucket_tick,
                category, tag, COUNT(*) AS count, SUM(amount) AS sum
            FROM "MetricsFact" INDEXED BY "idx_MetricsFact_tick"
            WHERE tick >= @tail_from_tick AND tick <= @to_tick AND type = @type${playerPredicate}
            GROUP BY bucket_tick, category, tag
        )
        GROUP BY bucket_tick, category, tag
        ORDER BY bucket_tick
    `;
}

/**
 * Node {@link AbstractMetricsStore}: SQLite-backed, WAL mode, bounded by METRICS_RETENTION_TICKS.
 * Facts stay raw for the whole retention window so offline analysis can read the file directly;
 * the buckets keep the chart's wider tiers off those millions of rows.
 */
export class NodeMetricsStore extends AbstractMetricsStore {

    /**
     * @param {string} [path] - SQLite file, or ":memory:" for an in-process store
     */
    constructor(path=":memory:") {
        super();
        this.db = new BetterSqlite3(path);
        this.db.pragma("journal_mode = WAL");
        // Metrics are worth a lost tail on power loss, not an fsync per tick.
        this.db.pragma("synchronous = NORMAL");
        this._createSchema();
        this._prepareWrites();
        this._prepareQueries();
        this._prepareFold();

        this._discardForeignBuckets();

        const bounds = this.db.prepare(`
            SELECT
                (SELECT MAX(bucket_tick) FROM "MetricsBucket" WHERE tier = @tier) AS baked,
                (SELECT MIN(tick) FROM "MetricsFact") AS oldest_fact,
                (SELECT MAX(tick) FROM "MetricsFact") AS latest_fact
        `).get({tier: METRICS_FOLD_TIER});
        /**
         * First tick no bucket covers yet; every fold window before it is complete. With no buckets
         * it starts at the oldest fact, so backfill doesn't walk empty ticks to reach the history.
         * @type {number}
         * @private
         */
        this._foldedThrough = this._startOfFolding(bounds);
        // Folds what an existing file holds ahead of its buckets, at open rather than inside a tick.
        this._foldThrough(bounds.latest_fact);
    }

    /**
     * Creates the fact and bucket tables with the indexes served queries walk.
     * @private
     * @returns {void}
     */
    _createSchema() {
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
            CREATE INDEX IF NOT EXISTS "idx_MetricsFact_tick"
                ON "MetricsFact" (tick)
        `);
        // Served queries reach facts by tick only, and offline analysis brings its own tooling.
        this.db.exec(`
            DROP INDEX IF EXISTS "idx_MetricsFact_type_tick";
            DROP INDEX IF EXISTS "idx_MetricsFact_player_type_tick";
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "MetricsBucket" (
                tier INTEGER NOT NULL,
                type INTEGER NOT NULL,
                player_id INTEGER NOT NULL,
                bucket_tick INTEGER NOT NULL,
                category INTEGER NOT NULL,
                tag INTEGER NOT NULL,
                count INTEGER NOT NULL,
                sum INTEGER NOT NULL,
                PRIMARY KEY (tier, type, player_id, bucket_tick, category, tag)
            ) WITHOUT ROWID
        `);
        // Earlier column orders, replaced by the two below.
        this.db.exec(`
            DROP INDEX IF EXISTS "idx_MetricsBucket_tier_type_tick";
            DROP INDEX IF EXISTS "idx_MetricsBucket_tick";
        `);
        // Unscoped reads stream straight off this one, aggregates included; player-scoped reads use
        // the primary key instead.
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS "idx_MetricsBucket_tier_type_tick_agg"
                ON "MetricsBucket" (tier, type, bucket_tick, category, tag, count, sum)
        `);
        // Folding a coarse tier and pruning both walk one tier by tick, with the type left free.
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS "idx_MetricsBucket_tier_tick"
                ON "MetricsBucket" (tier, bucket_tick)
        `);
    }

    /**
     * Prepares the fact insert and its batching transaction.
     * @private
     * @returns {void}
     */
    _prepareWrites() {
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
    }

    /**
     * Prepares the rollup reads, one per player scope.
     * @private
     * @returns {void}
     */
    _prepareQueries() {
        // Baked rows cover whole buckets, so an answer starts at the bucket @from_bucket names
        // rather than mid-bucket.
        this._queryRollupAllPlayers = this.db.prepare(
            rollupSql("", `INDEXED BY "idx_MetricsBucket_tier_type_tick_agg"`),
        );
        this._queryRollupForPlayer = this.db.prepare(rollupSql(" AND player_id = @player_id", ""));
    }

    /**
     * Prepares the fold and prune statements, and the transaction that runs them together.
     * @private
     * @returns {void}
     */
    _prepareFold() {
        this._foldFacts = this.db.prepare(`
            INSERT INTO "MetricsBucket" (tier, type, player_id, bucket_tick, category, tag, count, sum)
            SELECT
                @tier,
                type,
                player_id,
                ${bucketFloor("tick")} AS fold_bucket_tick,
                category,
                tag,
                COUNT(*),
                SUM(amount)
            FROM "MetricsFact" INDEXED BY "idx_MetricsFact_tick"
            WHERE tick >= @from_tick AND tick < @to_tick
            GROUP BY type, player_id, fold_bucket_tick, category, tag
            ON CONFLICT (tier, type, player_id, bucket_tick, category, tag) DO UPDATE SET
                count = "MetricsBucket".count + excluded.count,
                sum = "MetricsBucket".sum + excluded.sum
        `);
        // Coarse tiers fold from the fold tier's rows for the same window: complete already, and
        // orders of magnitude fewer than the facts behind them.
        this._foldCoarseTier = this.db.prepare(`
            INSERT INTO "MetricsBucket" (tier, type, player_id, bucket_tick, category, tag, count, sum)
            SELECT
                @tier,
                type,
                player_id,
                ${bucketFloor("bucket_tick")} AS fold_bucket_tick,
                category,
                tag,
                SUM(count),
                SUM(sum)
            FROM "MetricsBucket" INDEXED BY "idx_MetricsBucket_tier_tick"
            WHERE tier = @source_tier AND bucket_tick >= @from_tick AND bucket_tick < @to_tick
            GROUP BY type, player_id, fold_bucket_tick, category, tag
            ON CONFLICT (tier, type, player_id, bucket_tick, category, tag) DO UPDATE SET
                count = "MetricsBucket".count + excluded.count,
                sum = "MetricsBucket".sum + excluded.sum
        `);

        this._deleteFactsBefore = this.db.prepare(
            `DELETE FROM "MetricsFact" INDEXED BY "idx_MetricsFact_tick" WHERE tick < @cutoff`,
        );
        this._deleteBucketsBefore = this.db.prepare(`
            DELETE FROM "MetricsBucket" INDEXED BY "idx_MetricsBucket_tier_tick"
            WHERE tier = @tier AND bucket_tick < @cutoff
        `);

        // Retention rides the fold: both tables age out together, once per fold window.
        this._foldWindow = this.db.transaction((fromTick, toTick, cutoff) => {
            this._foldFacts.run({tier: METRICS_FOLD_TIER, from_tick: fromTick, to_tick: toTick});
            for (const tier of METRICS_COARSE_TIERS) {
                this._foldCoarseTier.run({
                    tier, source_tier: METRICS_FOLD_TIER, from_tick: fromTick, to_tick: toTick,
                });
            }
            if (cutoff > 0) {
                this._deleteFactsBefore.run({cutoff});
                for (const tier of METRICS_BAKED_TIERS) {
                    this._deleteBucketsBefore.run({tier, cutoff});
                }
            }
        });
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
     * Folds every window that closed since the last call, pruning as it goes.
     * @param {number} latestTick
     * @returns {Promise<void>}
     */
    async advanceTo(latestTick) {
        this._foldThrough(latestTick);
    }

    /**
     * @param {number} type
     * @param {number|null} playerId
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} tier
     * @returns {Promise<MetricsRollupRow[]>}
     */
    async queryRollup(type, playerId, fromTick, toTick, tier) {
        const tailFromTick = METRICS_BAKED_TIERS.includes(tier) ? Math.max(fromTick, this._foldedThrough) : fromTick;
        const params = {
            tier,
            type,
            from_bucket: bucketTickFor(fromTick, tier),
            tail_from_tick: tailFromTick,
            to_tick: toTick,
        };
        let rows;
        if (playerId === null) {
            rows = this._queryRollupAllPlayers.all(params);
        } else {
            rows = this._queryRollupForPlayer.all({...params, player_id: playerId});
        }
        return rows.map(row => new MetricsRollupRow(row.bucket_tick, row.category, row.tag, row.count, row.sum));
    }

    /**
     * Checkpoints the WAL into the main file and closes the connection.
     * @returns {Promise<void>}
     */
    async close() {
        this.db.pragma("wal_checkpoint(TRUNCATE)");
        this.db.close();
    }

    /**
     * Discards buckets this build would fold differently — a changed tier ladder or fold format —
     * since adding to them would mix rows covering different spans.
     * @returns {void}
     * @private
     */
    _discardForeignBuckets() {
        const tiers = this.db.prepare(`SELECT DISTINCT tier FROM "MetricsBucket" ORDER BY tier`).all();
        const version = this.db.pragma("user_version", {simple: true});
        const foreignTier = tiers.some(row => !METRICS_BAKED_TIERS.includes(row.tier));
        if (!foreignTier && version === BUCKET_FORMAT_VERSION) {
            return;
        }
        this.db.exec(`DELETE FROM "MetricsBucket"`);
        this.db.pragma(`user_version = ${BUCKET_FORMAT_VERSION}`);
    }

    /**
     * @param {{baked: number|null, oldest_fact: number|null}} bounds
     * @returns {number} tick folding resumes from
     * @private
     */
    _startOfFolding(bounds) {
        if (bounds.baked !== null) {
            return bounds.baked + METRICS_FOLD_TIER;
        }
        if (bounds.oldest_fact !== null) {
            return bucketTickFor(bounds.oldest_fact, METRICS_FOLD_TIER);
        }
        return 0;
    }

    /**
     * Folds up to the last window that closed at `latestTick`, a bounded chunk per transaction.
     * @param {number|null} latestTick
     * @returns {void}
     * @private
     */
    _foldThrough(latestTick) {
        if (latestTick === null) {
            return;
        }
        const boundary = bucketTickFor(latestTick, METRICS_FOLD_TIER);
        const cutoff = latestTick - METRICS_RETENTION_TICKS;
        while (this._foldedThrough < boundary) {
            const chunkTo = Math.min(boundary, this._foldedThrough + FOLD_CHUNK_TICKS);
            this._foldWindow(this._foldedThrough, chunkTo, cutoff);
            this._foldedThrough = chunkTo;
        }
    }
}
