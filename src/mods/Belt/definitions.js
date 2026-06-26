import {
    ObjectDefinition,
    PortDefinition,
    TickOp,
    TickPhase,
    Direction,
} from "@/sdk/common.js";
import {ITEM_TYPE_GAP} from "./constants.js";

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

            // Case 1: Output is full, or next item is a gap
            // TODO: Get list of items about to be resized, then insert event for those
            new TickOp(
                "TickBeltPathCase1",
                `UPDATE BeltPathItem
                SET length = length - 1
                WHERE id IN (
                    SELECT p.next_gap_id
                    FROM BeltPath p
                        INNER JOIN Port outPort ON outPort.id = p.out_port_id
                    WHERE (
                        p.next_gap_id IS NOT NULL
                        AND
                        (
                            -- Next item is a gap
                            p.next_gap_id < p.next_item_id
                                OR
                            p.next_item_id IS NULL
                                OR
                                -- Output is full
                            outPort.item IS NOT NULL
                            -- TODO: Check if child belt could accept the item? Not recursive
                        )
                        AND
                        p.id IN (
                            SELECT path_id FROM ActivePath
                        )
                    )
                );`
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

            new TickOp(
                "TickBeltFillOutPort",
                `UPDATE Port
                SET item=item.item_type
                FROM BeltPathOutputItem item
                WHERE Port.id = item.port_id;`
            ),

            // Now that this tick's pops have filled the out-ports (which are the
            // downstream paths' in-ports in a zero-gap chain), mark every path whose
            // in-port holds an item active, so InsertItem below ingests it this tick.
            //
            // INDEXED BY pins the query plan to the Port_in_filled partial index (the
            // is_in_port = 1 predicate matches it), so this reads only the filled
            // *in*-ports. The index is maintained by SQLite on every Port.item
            // write, so an item delivered into an in-port by any path (a pop, a transfer
            // flush, a direct write) is picked up here regardless of how it arrived.
            new TickOp(
                "ActivePathInput",
                `INSERT OR IGNORE INTO ActivePath (path_id)
                 SELECT path.id
                 FROM Port inPort INDEXED BY Port_in_filled
                    INNER JOIN BeltPath path ON path.in_port_id = inPort.id
                 WHERE inPort.item IS NOT NULL
                   AND inPort.is_in_port = 1;`
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
            // No explicit null-before-delete of next_gap_id/next_item_id: those
            // pointers are read only at the start of a tick (Case1/Case2, above) and
            // recomputed at the end (RecalculateNext*), and the recalc's LEFT JOIN
            // over ChangedPath already resets every changed/emptied path. A pointer
            // left dangling at a row Cleanup1 deletes below is never read before then.

            // Record the paths Cleanup1 is about to change before it deletes the
            // rows: items popped to an out-port (BeltPathOutputItem) and gaps a tick
            // consumed down to length 0. These plus the input paths below are the
            // only paths whose next_gap/next_item can have moved this tick.
            new TickOp(
                "CaptureChangedFromOutput",
                `INSERT OR IGNORE INTO ChangedPath (path_id)
                 SELECT path_id FROM BeltPathOutputItem;`
            ),
            // INDEXED BY pins the tiny BeltPathItem_zero partial index (length = 0 rows
            // are transient), so this collects the consumed-gap paths directly.
            new TickOp(
                "CaptureChangedFromZeroLength",
                `INSERT OR IGNORE INTO ChangedPath (path_id)
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

            // next_gap/next_item are the MIN id of a path's gap/non-gap rows. A path's
            // values are still correct unless its items changed this tick, so recompute
            // only ChangedPath. Each pointer is an O(1) leftmost lookup on its type-split
            // partial index (BeltPathItem_next_item / _next_gap, both ordered (path_id,
            // id)), so the recompute is O(changed paths). A correlated MIN yields NULL
            // when the path has no row of that kind.
            new TickOp(
                "RecalculateNextPointers",
                `UPDATE BeltPath
                    SET next_item_id = (
                            SELECT MIN(item.id) FROM BeltPathItem item INDEXED BY BeltPathItem_next_item
                            WHERE item.path_id = BeltPath.id AND item.type != ${ITEM_TYPE_GAP}
                        ),
                        next_gap_id = (
                            SELECT MIN(gap.id) FROM BeltPathItem gap INDEXED BY BeltPathItem_next_gap
                            WHERE gap.path_id = BeltPath.id AND gap.type = ${ITEM_TYPE_GAP}
                        )
                    WHERE id IN (SELECT path_id FROM ChangedPath);`
            ),

            new TickOp(
                "ClearChangedPath",
                `DELETE FROM ChangedPath;`
            )
        ],
        [TickPhase.COMMIT_TRANSFERS]: [
        ]
    },
);
