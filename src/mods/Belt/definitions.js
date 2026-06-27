import {
    ObjectDefinition,
    PortDefinition,
    TickOp,
    TickPhase,
    Direction,
    BUFFERED_EVENT_TYPE_PORT_ITEM_SET,
    BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR,
} from "@/sdk/common.js";
import {
    ITEM_TYPE_GAP,
    BUFFERED_EVENT_TYPE_ITEM_UPSERT,
    BUFFERED_EVENT_TYPE_ITEM_DELETE,
    BUFFERED_EVENT_TYPE_ITEM_RESET,
} from "./constants.js";

export const BeltDefinition = new ObjectDefinition(
    [
        new PortDefinition("virtual_left", {x: 0, y: 0, direction: Direction.RIGHT}),
        new PortDefinition("virtual_down", {x: 0, y: 0, direction: Direction.UP}),
        new PortDefinition("virtual_right", {x: 0, y: 0, direction: Direction.LEFT}),
    ],
    [
        new PortDefinition("virtual_up", {x: 0, y: -1, direction: Direction.UP}),
    ],
    [],
    {x: 0, y: 0},
    {
        [TickPhase.SUBMIT_INTENTS]: [

            // Rebuild the set of paths that can do anything this tick, so the
            // movement ops below run over it instead of every path in the world. A
            // path is live if it can pop an item (item ready + out-port free), is
            // shuffling a gap, or has an item waiting at its in-port. Each source is
            // an indexed lookup, so this is O(active), not O(world).
            new TickOp(
                "ClearActivePath",
                `DELETE FROM ActivePath;`
            ),
            new TickOp(
                "ClearChangedItem",
                `DELETE FROM ChangedItem;`
            ),
            new TickOp(
                "ClearResizeGap",
                `DELETE FROM ResizeGap;`
            ),
            // Only gap-shuffling paths need to be in ActivePath for the movement ops:
            // Case2 finds the paths that pop directly off the BeltPath_next_item partial
            // index (see below), and RecalculateHeadGap picks the popped paths back up
            // from BeltPathOutputItem.
            // INDEXED BY pins the query plan to the BeltPath_next_gap partial index
            // (every gap-shuffling path), so this is O(gap paths).
            new TickOp(
                "ActivePathGap",
                `INSERT OR IGNORE INTO ActivePath (path_id)
                 SELECT id FROM BeltPath INDEXED BY BeltPath_next_gap WHERE next_gap_id IS NOT NULL;`
            ),
            // Input activity is added later (after the out-ports are filled below),
            // because a path's out-port can be the downstream path's in-port: the pop
            // this tick must be visible to that downstream path's InsertItem.

            // Case 1: Output is full, or next item is a gap — the lead gap shrinks by
            // one. ResizeGap names those gaps (all active paths) so Case1 resizes from
            // it; the predicate lives here once. CaptureViewedResize (below) copies the
            // watched subset into ChangedItem for the emit.
            new TickOp(
                "CaptureResizeGaps",
                `INSERT OR IGNORE INTO ResizeGap (row_id, path_id)
                    SELECT p.next_gap_id, p.id
                    FROM BeltPath p
                        INNER JOIN Port outPort ON outPort.id = p.out_port_id
                    WHERE p.next_gap_id IS NOT NULL
                      AND (
                            -- Next item is a gap
                            p.next_gap_id < p.next_item_id
                                OR
                            p.next_item_id IS NULL
                                OR
                                -- Output is full
                            outPort.item IS NOT NULL
                            -- TODO: Check if child belt could accept the item? Not recursive
                        )
                      AND p.id IN (SELECT path_id FROM ActivePath);`
            ),
            new TickOp(
                "TickBeltPathCase1",
                `UPDATE BeltPathItem
                SET length = length - 1
                WHERE id IN (SELECT row_id FROM ResizeGap);`
            ),
            // Capture the watched resized gaps into ChangedItem (gated on viewport).
            // CROSS JOIN drives from the small ResizeGap; an INNER JOIN lets the planner
            // scan all of Belt instead.
            new TickOp(
                "CaptureViewedResize",
                `INSERT OR IGNORE INTO ChangedItem (row_id, path_id, x, y)
                 SELECT g.row_id, g.path_id, head.x, head.y
                 FROM ResizeGap g
                    CROSS JOIN Belt head ON head.id = g.path_id
                 WHERE head.chunk IN (SELECT chunk FROM SessionViewport);`
            ),
            // Case 2: output is not full and next item is not a gap
            //  - pop item into output port
            new TickOp(
                "TickBeltPathCase2",
                // Drives off the BeltPath_next_item partial index (every path with an
                // item ready to pop), so it is O(loaded paths). INDEXED BY pins the
                // query plan to that partial index.
                `INSERT INTO BeltPathOutputItem (path_id, item_id, item_type, port_id)
                SELECT BeltPath.id, item.id, item.type, outPort.id
                FROM BeltPath INDEXED BY BeltPath_next_item
                    INNER JOIN BeltPathItem item ON item.id = BeltPath.next_item_id
                    INNER JOIN Port outPort ON outPort.id = BeltPath.out_port_id
                WHERE BeltPath.next_item_id IS NOT NULL
                  -- Next item is an item
                  AND (
                        BeltPath.next_gap_id IS NULL
                            OR
                        BeltPath.next_item_id < BeltPath.next_gap_id
                    )
                  -- There is space in the output
                  AND outPort.item IS NULL;`
            ),
            // Popped items are deleted by Cleanup1; capture the watched ones now (gated
            // on viewport) so the emit phase reports each as a DELETE delta.
            new TickOp(
                "CapturePoppedItems",
                // CROSS JOIN drives from BeltPathOutputItem; an INNER JOIN lets the
                // planner scan all of Belt instead.
                `INSERT OR IGNORE INTO ChangedItem (row_id, path_id, x, y)
                 SELECT popped.item_id, popped.path_id, head.x, head.y
                 FROM BeltPathOutputItem popped
                    CROSS JOIN Belt head ON head.id = popped.path_id
                 WHERE head.chunk IN (SELECT chunk FROM SessionViewport);`
            ),

            // If there is a gap anywhere in the path (including a 0-length gap),
            // or if an item was consumed (output_item_id !=NULL)
            // this means that the head_gap needs to be incremented
            // (UNLESS an item was inserted this tick, in which case, head_gap will be reset to 0
            // in TickBeltPathCleanup5)
            new TickOp(
                "TickBeltPathRecalculateHeadGap",
                // A path advances its head gap if it shuffled a gap (an active gap path)
                // or popped an item this tick (in BeltPathOutputItem). The popped half is
                // caught via BeltPathOutputItem membership directly.
                `UPDATE BeltPath
                SET head_gap = head_gap + 1
                WHERE (next_gap_id IS NOT NULL AND id IN (SELECT path_id FROM ActivePath))
                   OR id IN (SELECT path_id FROM BeltPathOutputItem);`
            ),

            // Mark every path whose in-port already holds an item — left by a prior
            // tick, or by a transfer flush or direct write — active, so InsertItem
            // ingests it. This tick's own pops only reach the out-ports later
            // (FillOutPort, below), so an item popped into a shared port rests there a
            // tick before the downstream path ingests it.
            //
            // INDEXED BY pins the query plan to the Port_in_filled partial index (the
            // is_in_port = 1 predicate matches it), so this reads only the filled
            // *in*-ports.
            new TickOp(
                "ActivePathInput",
                `INSERT OR IGNORE INTO ActivePath (path_id)
                 SELECT path.id
                 FROM Port inPort INDEXED BY Port_in_filled
                    INNER JOIN BeltPath path ON path.in_port_id = inPort.id
                 WHERE inPort.item IS NOT NULL
                   AND inPort.is_in_port = 1;`
            ),

            // Snapshot the max row id so the rows InsertItem appends (higher ids) can
            // be captured into ChangedItem afterward as UPSERT deltas.
            new TickOp(
                "RecordMaxItemId",
                `UPDATE ItemIdMarker SET max_id = COALESCE((SELECT MAX(id) FROM BeltPathItem), 0);`
            ),

            new TickOp(
                "TickBeltPathInsertItem",
                // CROSS JOIN forces ActivePath as the driving table (otherwise the
                // planner scans all of BeltPath, since head_gap > 0 matches every path).
                `INSERT INTO BeltPathItem (path_id, type, length)
                    -- If the head gap is more than 1 spaces, add a gap item first
                    SELECT BeltPath.id,
                           0,
                           head_gap - 1
                    FROM ActivePath
                        CROSS JOIN BeltPath ON BeltPath.id = ActivePath.path_id
                        INNER JOIN Port inPort ON inPort.id = BeltPath.in_port_id
                    WHERE head_gap > 1
                      AND inPort.item IS NOT NULL
                    UNION ALL
                    -- item
                    SELECT BeltPath.id,
                           inPort.item,
                           1
                    FROM ActivePath
                        CROSS JOIN BeltPath ON BeltPath.id = ActivePath.path_id
                        INNER JOIN Port inPort ON inPort.id = BeltPath.in_port_id
                    WHERE head_gap > 0
                      AND inPort.item IS NOT NULL;`
            ),
            // Capture the watched newly-inserted rows (gated on viewport). CROSS JOIN
            // drives from the new BeltPathItem rows (id > marker), not all of Belt.
            new TickOp(
                "CaptureInsertedItems",
                `INSERT OR IGNORE INTO ChangedItem (row_id, path_id, x, y)
                 SELECT item.id, item.path_id, head.x, head.y
                 FROM BeltPathItem item
                    CROSS JOIN Belt head ON head.id = item.path_id
                 WHERE item.id > (SELECT max_id FROM ItemIdMarker)
                   AND head.chunk IN (SELECT chunk FROM SessionViewport);`
            ),
            // Newly-ingested gaps (a path with head_gap > 1 took input) move its
            // next_gap_id, so record those paths. The gap rows are the new BeltPathItem
            // rows of type GAP (id > marker), found via the same marker as the inserts.
            new TickOp(
                "CaptureGapChangedFromInput",
                `INSERT OR IGNORE INTO GapChangedPath (path_id)
                 SELECT path_id FROM BeltPathItem
                 WHERE id > (SELECT max_id FROM ItemIdMarker) AND type = ${ITEM_TYPE_GAP};`
            ),

            // Deliver this tick's pops to the out-ports — a downstream path's in-port
            // when they share it. Runs after InsertItem (above), so a popped item rests
            // in the shared port for a tick before the downstream path ingests it next.
            new TickOp(
                "TickBeltFillOutPort",
                `UPDATE Port
                SET item=item.item_type
                FROM BeltPathOutputItem item
                WHERE Port.id = item.port_id;`
            ),

            // No explicit null-before-delete of next_gap_id/next_item_id: those
            // pointers are read only at the start of a tick (Case1/Case2, above) and
            // recomputed at the end, which resets every changed/emptied path. A pointer
            // left dangling at a row Cleanup1 deletes below is never read before then.

            // Record the paths Cleanup1 is about to change before it deletes the rows:
            // items popped to an out-port move next_item_id (the min non-gap row went),
            // and gaps consumed to length 0 move next_gap_id (the min gap row went).
            new TickOp(
                "CaptureChangedFromOutput",
                `INSERT OR IGNORE INTO ChangedPath (path_id)
                 SELECT path_id FROM BeltPathOutputItem;`
            ),
            // INDEXED BY pins the tiny BeltPathItem_zero partial index (length = 0 rows
            // are transient), so this collects the consumed-gap paths directly.
            new TickOp(
                "CaptureChangedFromZeroLength",
                `INSERT OR IGNORE INTO GapChangedPath (path_id)
                 SELECT path_id FROM BeltPathItem INDEXED BY BeltPathItem_zero WHERE length = 0;`
            ),

            new TickOp(
                "TickBeltPathCleanup1",
                `DELETE
                 FROM BeltPathItem
                 WHERE length = 0 OR id IN (SELECT item_id FROM BeltPathOutputItem);`
            ),

            new TickOp(
                "TickBeltPathCleanup2",
                `DELETE FROM BeltPathOutputItem;`
            ),
            new TickOp(
                "TickBeltPathCleanup3",
                // CROSS JOIN forces ActivePath as the driving table (head_gap > 0
                // alone matches every path, so the planner would otherwise scan all).
                `INSERT INTO BeltPathInputItem (path_id, port_id)
                 SELECT BeltPath.id, Port.id
                 FROM ActivePath
                    CROSS JOIN BeltPath ON BeltPath.id = ActivePath.path_id
                    INNER JOIN Port ON Port.id = BeltPath.in_port_id
                 WHERE BeltPath.head_gap > 0
                   AND Port.item IS NOT NULL;`
            ),

            // The paths that just took in an item/gap from their in-port (the other
            // half of this tick's item changes; see CaptureChangedFromOutput).
            new TickOp(
                "CaptureChangedFromInput",
                `INSERT OR IGNORE INTO ChangedPath (path_id)
                 SELECT path_id FROM BeltPathInputItem;`
            ),
            new TickOp(
                "TickBeltPathCleanup4",
                `UPDATE Port
                 SET item = NULL
                 FROM BeltPathInputItem
                 WHERE Port.id = BeltPathInputItem.port_id;`
            ),

            new TickOp(
                "TickBeltPathCleanup5",
                `UPDATE BeltPath
                    SET head_gap = 0
                    FROM BeltPathInputItem
                    WHERE BeltPath.id = BeltPathInputItem.path_id;`
            ),
            new TickOp(
                "TickBeltPathCleanup6",
                `DELETE FROM BeltPathInputItem;`
            ),

            // next_item/next_gap are the MIN id of a path's non-gap/gap rows — an O(1)
            // leftmost lookup on the type-split partial index (BeltPathItem_next_item /
            // _next_gap, ordered (path_id, id)). Each pointer is recomputed only for the
            // paths whose rows of that kind changed, so most ticks the gap pass touches
            // almost nothing. A correlated MIN yields NULL when the path has no such row.
            new TickOp(
                "RecalculateNextItem",
                `UPDATE BeltPath
                    SET next_item_id = (
                            SELECT MIN(item.id) FROM BeltPathItem item INDEXED BY BeltPathItem_next_item
                            WHERE item.path_id = BeltPath.id AND item.type != ${ITEM_TYPE_GAP}
                        )
                    WHERE id IN (SELECT path_id FROM ChangedPath);`
            ),
            new TickOp(
                "RecalculateNextGap",
                `UPDATE BeltPath
                    SET next_gap_id = (
                            SELECT MIN(gap.id) FROM BeltPathItem gap INDEXED BY BeltPathItem_next_gap
                            WHERE gap.path_id = BeltPath.id AND gap.type = ${ITEM_TYPE_GAP}
                        )
                    WHERE id IN (SELECT path_id FROM GapChangedPath);`
            ),

            new TickOp(
                "ClearChangedPath",
                `DELETE FROM ChangedPath;`
            ),
            new TickOp(
                "ClearGapChangedPath",
                `DELETE FROM GapChangedPath;`
            ),

            // ChangedItem already holds only watched rows (the captures gate on
            // viewport) with the head tile, so the item emits just fan it out — no Belt
            // join, no chunk filter. The sim runs everywhere, but a delta only matters
            // to a session watching that chunk (unwatched chunks re-sync on subscribe).

            // Resync: rebuild each path the client must re-row — a belt edit re-rowed it,
            // or a new viewer subscribed. RESET clears the client's stale rows first, in
            // the same drain as the re-emitted rows below (an atomic swap, no flicker).
            // The rows come as plain UPSERTs so each re-created sprite glides in from a
            // half-tile upstream ≈ the departed sprite's spot (no teleport). Both gated
            // on viewport; x/y is the head tile (one chunk).
            new TickOp(
                "EmitResyncReset",
                `INSERT INTO BufferedEvent (time, type, x, y, id, a, b, c)
                 SELECT @time, ${BUFFERED_EVENT_TYPE_ITEM_RESET}, head.x, head.y,
                        rp.path_id, NULL, NULL, NULL
                 -- CROSS JOIN forces the tiny resync set to drive. ANALYZE can't help:
                 -- ResyncItemPath is a rowid-only temp table, so it gets no stat1 row and
                 -- the planner otherwise scans the whole Belt table every idle tick.
                 FROM ResyncItemPath rp
                    CROSS JOIN Belt head ON head.id = rp.path_id
                 WHERE head.chunk IN (SELECT chunk FROM SessionViewport);`
            ),
            new TickOp(
                "EmitResyncItems",
                `INSERT INTO BufferedEvent (time, type, x, y, id, a, b, c)
                 SELECT @time, ${BUFFERED_EVENT_TYPE_ITEM_UPSERT}, head.x, head.y,
                        item.path_id, item.id, item.length, item.type
                 FROM BeltPathItem item
                    INNER JOIN Belt head ON head.id = item.path_id
                 WHERE item.path_id IN (SELECT path_id FROM ResyncItemPath)
                   AND head.chunk IN (SELECT chunk FROM SessionViewport);`
            ),
            new TickOp(
                "ClearResyncItemPath",
                `DELETE FROM ResyncItemPath;`
            ),

            // UPSERT delta for each changed row still present (resized or inserted).
            new TickOp(
                "EmitItemUpserts",
                `INSERT INTO BufferedEvent (time, type, x, y, id, a, b, c)
                 SELECT @time, ${BUFFERED_EVENT_TYPE_ITEM_UPSERT}, ci.x, ci.y,
                        ci.path_id, ci.row_id, item.length, item.type
                 FROM ChangedItem ci
                    INNER JOIN BeltPathItem item ON item.id = ci.row_id;`
            ),
            // DELETE delta for each changed row now gone (popped or shrunk to nothing).
            new TickOp(
                "EmitItemDeletes",
                `INSERT INTO BufferedEvent (time, type, x, y, id, a, b, c)
                 SELECT @time, ${BUFFERED_EVENT_TYPE_ITEM_DELETE}, ci.x, ci.y,
                        ci.path_id, ci.row_id, NULL, NULL
                 FROM ChangedItem ci
                 WHERE ci.row_id NOT IN (SELECT id FROM BeltPathItem);`
            )
        ],
        [TickPhase.COMMIT_TRANSFERS]: [
            // Port transfers have settled (core ops ran first this phase). Emit deltas
            // for watched out-ports whose resting item changed, diffing against
            // OutPortItemShadow. The event carries only the port id (a=item type); the
            // client infers the render tile from the out-port -> path mapping it holds.
            // x/y is the head tile, for chunk routing only. These drive from the watched
            // chunks (via Belt_chunk) -> their head belts -> out-ports, so the cost is
            // O(belts in view), not O(filled ports in the whole world).
            new TickOp(
                "EmitOutPortItemSet",
                `WITH viewed_chunk AS (SELECT DISTINCT chunk FROM SessionViewport)
                 INSERT INTO BufferedEvent (time, type, x, y, id, a, b, c)
                 SELECT @time, ${BUFFERED_EVENT_TYPE_PORT_ITEM_SET}, head.x, head.y, p.id, p.item, NULL, NULL
                 FROM viewed_chunk vc
                    CROSS JOIN Belt head INDEXED BY Belt_chunk ON head.chunk = vc.chunk
                    CROSS JOIN BeltPath bp ON bp.id = head.id
                    CROSS JOIN Port p ON p.id = bp.out_port_id
                    LEFT JOIN OutPortItemShadow s ON s.port_id = p.id
                 WHERE p.item IS NOT NULL
                    AND (s.port_id IS NULL OR s.item != p.item);`
            ),
            new TickOp(
                "EmitOutPortItemClear",
                `WITH viewed_chunk AS (SELECT DISTINCT chunk FROM SessionViewport),
                      viewed_filled AS (
                        SELECT p.id
                        FROM viewed_chunk vc
                            CROSS JOIN Belt head INDEXED BY Belt_chunk ON head.chunk = vc.chunk
                            CROSS JOIN BeltPath bp ON bp.id = head.id
                            CROSS JOIN Port p ON p.id = bp.out_port_id
                        WHERE p.item IS NOT NULL
                      )
                 INSERT INTO BufferedEvent (time, type, x, y, id, a, b, c)
                 SELECT @time, ${BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR}, s.x, s.y, s.port_id, NULL, NULL, NULL
                 FROM OutPortItemShadow s
                 WHERE s.port_id NOT IN (SELECT id FROM viewed_filled);`
            ),
            new TickOp("ClearOutPortItemShadow", `DELETE FROM OutPortItemShadow;`),
            new TickOp(
                "RebuildOutPortItemShadow",
                `WITH viewed_chunk AS (SELECT DISTINCT chunk FROM SessionViewport)
                 INSERT INTO OutPortItemShadow (port_id, item, x, y)
                 SELECT p.id, p.item, head.x, head.y
                 FROM viewed_chunk vc
                    CROSS JOIN Belt head INDEXED BY Belt_chunk ON head.chunk = vc.chunk
                    CROSS JOIN BeltPath bp ON bp.id = head.id
                    CROSS JOIN Port p ON p.id = bp.out_port_id
                 WHERE p.item IS NOT NULL;`
            ),
        ]
    },
);
