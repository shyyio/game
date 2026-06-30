import {
    ObjectDefinition,
    PortDefinition,
    TickOp,
    TickPhase,
    Direction,
    CHUNK_COORD_SQL,
    OCCUPANCY_LAYER_SURFACE,
} from "@/sdk/common.js";
import {
    ITEM_TYPE_GAP,
    BELT_UNDERGROUND,
    OCCUPANCY_LAYER_UNDERGROUND_BASE,
    BUFFERED_EVENT_TYPE_ITEM_UPSERT,
    BUFFERED_EVENT_TYPE_ITEM_DELETE,
    BUFFERED_EVENT_TYPE_ITEM_RESET,
} from "./constants.js";

// ---- Splitter seam ops ----
// A splitter shares its input Port rows with the upstream belts and its output Port rows
// with the downstream belts, so its item moves must interleave with the belt POST_RESOLVE
// handoff exactly where a belt-belt seam does. The two stages run as one pipeline each
// tick (so throughput is full), but in an order that leaves each item resting one tick in
// an internal port (so it crosses at belt speed, not instantly):
//   1. read the rested int item and the rested in item (RecordStage2 / RecordStage1),
//   2. clear those source ports (ClearStage2Source / ClearStage1Source) — the in clear
//      must precede TickBeltFillOutPort, which is where the upstream belt refills it,
//   3. refill the internal ports from stage 1 (FillStage1),
//   4. after TickBeltFillOutPort (so the downstream belt ingested the previous output),
//      write the chosen out ports from stage 2 (FillStage2Output).
// Self-managed (the resolved intents are managed=0): the engine's managed commit clears a
// source in COMMIT_TRANSFERS, too late — it would wipe the upstream belt's fresh fill.
// Each op scans Splitter and probes ResolvedPortTransfer by source_id (the ResolvedPortTransfer_source
// index); only a splitter whose hop resolved this tick emits a row.

// Stage 2: record each internal port's resolved output target (and its item) before clearing it.
const SplitterRecordStage2 = new TickOp(
    "SplitterRecordStage2",
    `INSERT INTO SplitterStage2 (out_port_id, item, int_port_id)
     SELECT pt.destination_id, src.item, s.int_a_id
     FROM Splitter s
        INNER JOIN ResolvedPortTransfer pt ON pt.source_id = s.int_a_id
        INNER JOIN Port src ON src.id = s.int_a_id
     WHERE src.item IS NOT NULL
     UNION ALL
     SELECT pt.destination_id, src.item, s.int_b_id
     FROM Splitter s
        INNER JOIN ResolvedPortTransfer pt ON pt.source_id = s.int_b_id
        INNER JOIN Port src ON src.id = s.int_b_id
     WHERE src.item IS NOT NULL;`
);

// Stage 1: record each input port's resolved internal target (and its item) before clearing it.
const SplitterRecordStage1 = new TickOp(
    "SplitterRecordStage1",
    `INSERT INTO SplitterStage1 (int_port_id, item, in_port_id)
     SELECT pt.destination_id, src.item, s.in_a_id
     FROM Splitter s
        INNER JOIN ResolvedPortTransfer pt ON pt.source_id = s.in_a_id
        INNER JOIN Port src ON src.id = s.in_a_id
     WHERE src.item IS NOT NULL
     UNION ALL
     SELECT pt.destination_id, src.item, s.in_b_id
     FROM Splitter s
        INNER JOIN ResolvedPortTransfer pt ON pt.source_id = s.in_b_id
        INNER JOIN Port src ON src.id = s.in_b_id
     WHERE src.item IS NOT NULL;`
);

// Clear the consumed internal ports (drained to an output this tick); FillStage1 refills
// the ones stage 1 fed, leaving empty any that stage 1 did not.
const SplitterClearStage2Source = new TickOp(
    "SplitterClearStage2Source",
    `UPDATE Port SET item = NULL WHERE id IN (SELECT int_port_id FROM SplitterStage2);`
);

// Clear the consumed input ports before the upstream belt refills them (TickBeltFillOutPort).
const SplitterClearStage1Source = new TickOp(
    "SplitterClearStage1Source",
    `UPDATE Port SET item = NULL WHERE id IN (SELECT in_port_id FROM SplitterStage1);`
);

// Buffer stage 1's items into the internal ports (just cleared by ClearStage2Source for
// the pipelined ones), where they rest a tick before stage 2 routes them next tick.
const SplitterFillStage1 = new TickOp(
    "SplitterFillStage1",
    `UPDATE Port
     SET item = s.item
     FROM SplitterStage1 s
     WHERE Port.id = s.int_port_id;`
);

// Write each routed item into its chosen out-port, after the downstream belt ingested the
// previous one — so it rests there a tick, matching the belt-belt seam.
const SplitterFillStage2Output = new TickOp(
    "SplitterFillStage2Output",
    `UPDATE Port
     SET item = s.item
     FROM SplitterStage2 s
     WHERE Port.id = s.out_port_id;`
);

const SplitterClearStage1 = new TickOp(
    "SplitterClearStage1",
    `DELETE FROM SplitterStage1;`
);

const SplitterClearStage2 = new TickOp(
    "SplitterClearStage2",
    `DELETE FROM SplitterStage2;`
);

// A belt's ports live on BeltPath (head's in_port, tail's out_port), not a Belt column,
// so the generic per-column lookup can't reach them.
class BeltObjectDefinition extends ObjectDefinition {

    portLookups(table, portKind, direction) {
        if (portKind === "inputPorts") {
            // A head receives at its in_port from any side, so direction is ignored.
            return [`
                SELECT BeltPath.in_port_id AS id
                FROM BeltPath
                    INNER JOIN Belt head ON head.id = BeltPath.id
                WHERE head.x = @x AND head.y = @y`];
        }
        return [`
            SELECT BeltPath.out_port_id AS id
            FROM BeltPath
                INNER JOIN Belt tail ON tail.id = BeltPath.tail_id
            WHERE tail.x = @x - ${Direction.dx(direction)}
              AND tail.y = @y - ${Direction.dy(direction)}
              AND tail.direction = ${direction}`];
    }

    // A belt's ports live on BeltPath (head's in_port, tail's out_port), not a Belt column,
    // so the generic per-column reference guards can't reach them.
    portReferenceLookups(table) {
        return [`SELECT 1 FROM BeltPath WHERE BeltPath.in_port_id = Port.id OR BeltPath.out_port_id = Port.id`];
    }

    outputPortReferenceLookups(table) {
        return [`SELECT 1 FROM BeltPath WHERE BeltPath.out_port_id = Port.id`];
    }

    // A surface belt sits on SURFACE; an underground occupies one layer per axis, so a
    // surface belt and two crossing tunnels coexist on a tile.
    occupancyLookups(table) {
        return [`
            SELECT 1 FROM ${table}
            WHERE @layer = ${OCCUPANCY_LAYER_SURFACE}
              AND ${table}.type != ${BELT_UNDERGROUND}
              AND ${table}.x = @x AND ${table}.y = @y`,
        `
            SELECT 1 FROM ${table}
            WHERE @layer = ${OCCUPANCY_LAYER_UNDERGROUND_BASE} + (${table}.direction % 2)
              AND ${table}.type = ${BELT_UNDERGROUND}
              AND ${table}.x = @x AND ${table}.y = @y`];
    }
}

export const BeltDefinition = new BeltObjectDefinition({
    table: "Belt",
    inputPorts: [
        new PortDefinition("virtual_left", {x: 0, y: 0, direction: Direction.RIGHT}),
        new PortDefinition("virtual_down", {x: 0, y: 0, direction: Direction.UP}),
        new PortDefinition("virtual_right", {x: 0, y: 0, direction: Direction.LEFT}),
    ],
    outputPorts: [
        // Captured manually from BeltPath (CaptureBeltPathPortItems), not this virtual port.
        new PortDefinition("virtual_up", {x: 0, y: -1, direction: Direction.UP}, false),
    ],
    internalPorts: [],
    geometry: "1x1",
    tickPhases: {
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

            // Each loaded path (a lead item ready to pop) submits a virtual port-transfer
            // intent (in-port -> out-port, managed=0) so the engine resolves the shift
            // chain across shared seam ports. destination_is_empty is the base case the
            // generic resolver can't see for itself: the out-port is free, or the
            // downstream path can ingest this tick without itself popping (it has head
            // room or a gap to shrink). The resolver's recursion then adds the packed-
            // chain-also-pops case. The movement below pops exactly the paths whose intent
            // resolved (ResolvedPortTransfer rows with managed=0).
            new TickOp(
                "SubmitBeltShiftIntent",
                `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, managed)
                 SELECT p.in_port_id AS source_id,
                        p.out_port_id AS destination_id,
                        (op.item IS NULL
                            OR (down.id IS NOT NULL AND (down.head_gap > 0 OR down.next_gap_id IS NOT NULL)))
                            AS destination_is_empty,
                        0 AS managed
                 FROM BeltPath p INDEXED BY BeltPath_next_item
                    INNER JOIN Port op ON op.id = p.out_port_id
                    LEFT JOIN BeltPath down ON down.in_port_id = p.out_port_id
                 WHERE p.next_item_id IS NOT NULL
                   AND (p.next_gap_id IS NULL OR p.next_item_id < p.next_gap_id);`
            ),

            // Declare each in-port a path will drain this tick by ingesting it into head
            // room (head_gap > 0 / a gap to shrink) without popping — a drain the chain
            // can't otherwise see (no transfer represents it). A destination-less intent
            // marks the in-port a resolved source, so an upstream transfer into it (a belt,
            // or a splitter output) resolves, agnostic to who is upstream. Gated on a filled
            // in-port, so it rides the Port_in_filled partial index and stays proportional
            // to active seams rather than every path.
            new TickOp(
                "SubmitBeltIngestReadiness",
                `INSERT INTO PortTransferIntent (source_id, destination_id, managed)
                 SELECT inPort.id, NULL AS destination_id, 0 AS managed
                 FROM Port inPort INDEXED BY Port_in_filled
                    INNER JOIN BeltPath path ON path.in_port_id = inPort.id
                 WHERE inPort.item IS NOT NULL
                   AND inPort.is_in_port = 1
                   AND (path.head_gap > 0 OR path.next_gap_id IS NOT NULL);`
            ),
        ],

        // The engine has now resolved the shift chain. The movement runs here, popping
        // the paths whose virtual intent succeeded.
        [TickPhase.POST_RESOLVE]: [
            // Case 1: the path can't pop (its intent didn't resolve) or its next item is a
            // gap — the lead gap shrinks by one. ResizeGap names those gaps (all active
            // paths) so Case1 resizes from it; the predicate lives here once.
            // CaptureViewedResize (below) copies the watched subset into ChangedItem.
            new TickOp(
                "CaptureResizeGaps",
                `INSERT OR IGNORE INTO ResizeGap (row_id, path_id)
                    SELECT p.next_gap_id AS row_id,
                           p.id AS path_id
                    FROM BeltPath p
                    WHERE p.next_gap_id IS NOT NULL
                      AND (
                            -- Next item is a gap
                            p.next_gap_id < p.next_item_id
                                OR
                            p.next_item_id IS NULL
                                OR
                            -- The path can't pop this tick: its shift intent didn't resolve.
                            p.out_port_id NOT IN (SELECT destination_id FROM ResolvedPortTransfer WHERE managed=0)
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
                SELECT BeltPath.id AS path_id,
                       item.id AS item_id,
                       item.type AS item_type,
                       BeltPath.out_port_id AS port_id
                FROM BeltPath INDEXED BY BeltPath_next_item
                    INNER JOIN BeltPathItem item ON item.id = BeltPath.next_item_id
                WHERE BeltPath.next_item_id IS NOT NULL
                  -- Next item is an item
                  AND (
                        BeltPath.next_gap_id IS NULL
                            OR
                        BeltPath.next_item_id < BeltPath.next_gap_id
                    )
                  -- The path's shift intent resolved: the output is free now, or it
                  -- drains this tick (the downstream ingests, recursively up the chain).
                  AND BeltPath.out_port_id IN (SELECT destination_id FROM ResolvedPortTransfer WHERE managed=0);`
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

            // Splitter consume: read each resolved hop's rested item, then clear its
            // source port. The input clears must precede TickBeltFillOutPort below, where
            // the upstream belt refills that shared port. FillStage1 then re-buffers the
            // internal ports for next tick. See the seam-op block above for the ordering.
            SplitterRecordStage2,
            SplitterRecordStage1,
            SplitterClearStage2Source,
            SplitterClearStage1Source,
            SplitterFillStage1,

            // Deliver this tick's pops to the out-ports. Deferred to here — after the
            // in-port ingest (Cleanup3-5) — so filling a shared seam port (a downstream
            // path's in-port) isn't mistaken for an ingest by that path: the popped item
            // rests in the seam a tick before the downstream path takes it next tick.
            new TickOp(
                "TickBeltFillOutPort",
                `UPDATE Port
                SET item=item.item_type
                FROM BeltPathOutputItem item
                WHERE Port.id = item.port_id;`
            ),

            // Splitter fill: write each routed item into its chosen out-port, after the
            // downstream belt above ingested the previous one — so it rests there a tick.
            SplitterFillStage2Output,
            SplitterClearStage1,
            SplitterClearStage2,
            // FillOutPort was the last reader of BeltPathOutputItem, so clear it now.
            new TickOp(
                "TickBeltPathCleanup2",
                `DELETE FROM BeltPathOutputItem;`
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
                `INSERT INTO BufferedEvent (type, routing_chunk_x, routing_chunk_y, id, a, b, c)
                 SELECT ${BUFFERED_EVENT_TYPE_ITEM_RESET}, ${CHUNK_COORD_SQL("head.x")}, ${CHUNK_COORD_SQL("head.y")},
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
                `INSERT INTO BufferedEvent (type, routing_chunk_x, routing_chunk_y, id, a, b, c)
                 SELECT ${BUFFERED_EVENT_TYPE_ITEM_UPSERT}, ${CHUNK_COORD_SQL("head.x")}, ${CHUNK_COORD_SQL("head.y")},
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
                `INSERT INTO BufferedEvent (type, routing_chunk_x, routing_chunk_y, id, a, b, c)
                 SELECT ${BUFFERED_EVENT_TYPE_ITEM_UPSERT}, ${CHUNK_COORD_SQL("ci.x")}, ${CHUNK_COORD_SQL("ci.y")},
                        ci.path_id, ci.row_id, item.length, item.type
                 FROM ChangedItem ci
                    INNER JOIN BeltPathItem item ON item.id = ci.row_id;`
            ),
            // DELETE delta for each changed row now gone (popped or shrunk to nothing).
            new TickOp(
                "EmitItemDeletes",
                `INSERT INTO BufferedEvent (type, routing_chunk_x, routing_chunk_y, id, a, b, c)
                 SELECT ${BUFFERED_EVENT_TYPE_ITEM_DELETE}, ${CHUNK_COORD_SQL("ci.x")}, ${CHUNK_COORD_SQL("ci.y")},
                        ci.path_id, ci.row_id, NULL, NULL
                 FROM ChangedItem ci
                 WHERE ci.row_id NOT IN (SELECT id FROM BeltPathItem);`
            )
        ],
        [TickPhase.COMMIT_TRANSFERS]: [
            // Port transfers have settled. A belt's rendered out-port lives on BeltPath (head's
            // out_port), not the Belt row, so it can't go through the engine's declarative
            // renderedOutputPorts; capture it manually into the shared ViewedPortItem, routed by
            // the head tile. O(belts in view) via Belt_chunk. The engine diffs/emits/rebuilds.
            new TickOp(
                "CaptureBeltPathPortItems",
                `WITH viewed_chunk AS (SELECT DISTINCT chunk FROM SessionViewport)
                 INSERT INTO ViewedPortItem (port_id, item, x, y)
                 SELECT p.id, p.item, head.x, head.y
                 FROM viewed_chunk vc
                    CROSS JOIN Belt head INDEXED BY Belt_chunk ON head.chunk = vc.chunk
                    CROSS JOIN BeltPath bp ON bp.id = head.id
                    CROSS JOIN Port p ON p.id = bp.out_port_id
                 WHERE p.item IS NOT NULL;`
            ),
        ]
    },
});

// A 1x2 router with two inputs and two outputs (ports shared with adjacent belts) and two
// internal buffer ports. Each item flows in_X -> int_X -> out_Y, resting a tick in int_X so
// it crosses at belt speed. It submits managed=0 chain intents (the resolver links the whole
// in -> int -> out -> downstream run so it pipelines at full throughput); the moves are done
// by the seam ops spliced into BeltDefinition's POST_RESOLVE above. See those ops for why.
//
// Stage 2 fans out: it submits BOTH int_X -> out_A and int_X -> out_B, ranked by
// `alternatives_rank` (round-robin state ranks the preferred output 1, the other 2). The
// resolver hands each output to its best-ranking source and keeps each internal port's
// best-ranked resolved output, so the item takes the preferred output, or the other when the
// preferred can't drain this tick — agnostic to whatever is downstream, since drainability
// comes from the chain, not a peek at the neighbor.
export const SplitterDefinition = new ObjectDefinition({
    table: "Splitter",
    inputPorts: [
        new PortDefinition("in_a", {x: 0, y: 0, direction: Direction.UP}),
        new PortDefinition("in_b", {x: 1, y: 0, direction: Direction.UP}),
    ],
    outputPorts: [
        new PortDefinition("out_a", {x: 0, y: -1, direction: Direction.UP}),
        new PortDefinition("out_b", {x: 1, y: -1, direction: Direction.UP}),
    ],
    internalPorts: [
        new PortDefinition("int_a"),
        new PortDefinition("int_b"),
    ],
    geometry: "1x2",
    tickPhases: {
        [TickPhase.SUBMIT_INTENTS]: [
            // Stage 1: buffer each loaded input into its internal port. Single destination
            // (not a fan-out), destination_is_empty is exact (the internal port is the
            // splitter's own), and the chain resolves it when stage 2 drains int_X this
            // tick — so input and output pipeline together at full throughput.
            new TickOp(
                "SubmitSplitterStage1",
                `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, managed)
                 SELECT s.in_a_id, s.int_a_id, (ia.item IS NULL), 0
                 FROM Splitter s
                    INNER JOIN Port inp ON inp.id = s.in_a_id
                    INNER JOIN Port ia ON ia.id = s.int_a_id
                 WHERE inp.item IS NOT NULL
                 UNION ALL
                 SELECT s.in_b_id, s.int_b_id, (ib.item IS NULL), 0
                 FROM Splitter s
                    INNER JOIN Port inp ON inp.id = s.in_b_id
                    INNER JOIN Port ib ON ib.id = s.int_b_id
                 WHERE inp.item IS NOT NULL;`
            ),

            // Stage 2: route each loaded internal port to BOTH outputs as competing fan-out
            // intents. alternatives_rank encodes the round-robin choice, ranking the
            // preferred output 1 and the other 2 (state=0: A->out_A, B->out_B; state=1
            // inverted). destination_is_empty is the base case (out empty);
            // an occupied-but-draining output still resolves through the chain recursion.
            new TickOp(
                "SubmitSplitterStage2",
                `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, managed, alternatives_rank)
                 SELECT s.int_a_id, s.out_a_id, (oa.item IS NULL), 0,
                        CASE WHEN s.state = 0 THEN 1 ELSE 2 END
                 FROM Splitter s
                    INNER JOIN Port ia ON ia.id = s.int_a_id
                    INNER JOIN Port oa ON oa.id = s.out_a_id
                 WHERE ia.item IS NOT NULL
                 UNION ALL
                 SELECT s.int_a_id, s.out_b_id, (ob.item IS NULL), 0,
                        CASE WHEN s.state = 0 THEN 2 ELSE 1 END
                 FROM Splitter s
                    INNER JOIN Port ia ON ia.id = s.int_a_id
                    INNER JOIN Port ob ON ob.id = s.out_b_id
                 WHERE ia.item IS NOT NULL
                 UNION ALL
                 SELECT s.int_b_id, s.out_b_id, (ob.item IS NULL), 0,
                        CASE WHEN s.state = 0 THEN 1 ELSE 2 END
                 FROM Splitter s
                    INNER JOIN Port ib ON ib.id = s.int_b_id
                    INNER JOIN Port ob ON ob.id = s.out_b_id
                 WHERE ib.item IS NOT NULL
                 UNION ALL
                 SELECT s.int_b_id, s.out_a_id, (oa.item IS NULL), 0,
                        CASE WHEN s.state = 0 THEN 2 ELSE 1 END
                 FROM Splitter s
                    INNER JOIN Port ib ON ib.id = s.int_b_id
                    INNER JOIN Port oa ON oa.id = s.out_a_id
                 WHERE ib.item IS NOT NULL;`
            ),
        ],
        [TickPhase.POST_RESOLVE]: [
            // Advance the round-robin phase once for each splitter that routed an item this
            // tick (a resolved transfer sourced from one of its internal ports). One flip
            // per tick (not per lane) keeps both outputs saturated when both inputs are.
            new TickOp(
                "AdvanceSplitterState",
                `UPDATE Splitter
                 SET state = 1 - state
                 WHERE EXISTS (
                     SELECT 1 FROM ResolvedPortTransfer pt
                     WHERE pt.source_id = Splitter.int_a_id
                        OR pt.source_id = Splitter.int_b_id
                 );`
            ),
        ],
    },
    renderConnections: true,
    textureName: "splitter/1",
    label: "Splitter",
});
