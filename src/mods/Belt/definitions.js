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
            new TickOp(
                "ActivePathPoppable",
                `INSERT OR IGNORE INTO ActivePath (path_id)
                 SELECT path.id
                 FROM BeltPath path
                    INNER JOIN Port outPort ON outPort.id = path.out_port_id
                 WHERE path.next_item_id IS NOT NULL
                   AND outPort.item IS NULL;`
            ),
            new TickOp(
                "ActivePathGap",
                `INSERT OR IGNORE INTO ActivePath (path_id)
                 SELECT id FROM BeltPath WHERE next_gap_id IS NOT NULL;`
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
                        INNER JOIN ActivePath ON ActivePath.path_id = p.id
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
                    )
                );`
            ),
            // Case 2: output is not full and next item is not a gap
            //  - pop item into output port
            new TickOp(
                "TickBeltPathCase2",
                `INSERT INTO BeltPathOutputItem (path_id, item_id, item_type, port_id)
                SELECT BeltPath.id, item.id, item.type, outPort.id
                FROM BeltPath
                         INNER JOIN ActivePath ON ActivePath.path_id = BeltPath.id
                         INNER JOIN BeltPathItem item ON item.id = next_item_id
                         INNER JOIN Port outPort ON outPort.id = out_port_id
                WHERE
                  -- Next item is an item
                    (
                        next_gap_id IS NULL
                            OR
                        next_item_id < next_gap_id
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
                `UPDATE BeltPath
                SET head_gap = head_gap + 1
                WHERE id IN (SELECT path_id FROM ActivePath)
                  AND (
                    next_gap_id IS NOT NULL
                    OR id IN (SELECT path_id FROM BeltPathOutputItem)
                );`
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
            new TickOp(
                "ActivePathInput",
                `INSERT OR IGNORE INTO ActivePath (path_id)
                 SELECT path.id
                 FROM Port inPort
                    INNER JOIN BeltPath path ON path.in_port_id = inPort.id
                 WHERE inPort.item IS NOT NULL;`
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
            new TickOp(
                "CaptureChangedFromZeroLength",
                `INSERT OR IGNORE INTO ChangedPath (path_id)
                 SELECT path_id FROM BeltPathItem WHERE length = 0;`
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
            // only ChangedPath, in a single pass over its items with conditional MINs
            // (LEFT JOIN yields NULL for a kind of row the path no longer has).
            new TickOp(
                "RecalculateNextPointers",
                `WITH new_values (id, next_gap_id, next_item_id) AS (
                        SELECT changed.path_id,
                               MIN(CASE WHEN item.type =  ${ITEM_TYPE_GAP} THEN item.id END),
                               MIN(CASE WHEN item.type != ${ITEM_TYPE_GAP} THEN item.id END)
                        FROM ChangedPath changed
                            LEFT JOIN BeltPathItem item ON item.path_id = changed.path_id
                        GROUP BY changed.path_id
                    )
                    UPDATE BeltPath
                        SET next_gap_id = new.next_gap_id,
                            next_item_id = new.next_item_id
                    FROM new_values new
                    WHERE BeltPath.id = new.id;`
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
