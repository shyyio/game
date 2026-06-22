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
                WHERE (
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

            new TickOp(
                "TickBeltPathInsertItem",
                `INSERT INTO BeltPathItem (path_id, type, length)
                    -- If the head gap is more than 1 spaces, add a gap item first
                    SELECT BeltPath.id,
                           0,
                           head_gap - 1
                    FROM BeltPath
                        INNER JOIN Port inPort ON inPort.id = in_port_id
                    WHERE head_gap > 1
                      AND inPort.item IS NOT NULL
                    UNION ALL
                    -- item
                    SELECT BeltPath.id,
                           inPort.item,
                           1
                    FROM BeltPath
                        INNER JOIN Port inPort ON inPort.id = in_port_id
                    WHERE head_gap > 0
                      AND inPort.item IS NOT NULL;`
            ),
            new TickOp(
                "NullNextGapBeforeDelete",
                `UPDATE BeltPath
                    SET next_gap_id = NULL
                    WHERE next_gap_id IS NOT NULL
                      AND next_gap_id IN (
                          SELECT id FROM BeltPathItem WHERE length = 0
                      );`
            ),

            new TickOp(
                "NullNextItemBeforeDelete",
                `UPDATE BeltPath
                    SET next_item_id = NULL
                    WHERE next_item_id IS NOT NULL
                      AND next_item_id IN (
                          SELECT item_id FROM BeltPathOutputItem
                      );`
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
                `INSERT INTO BeltPathInputItem (path_id, port_id)
                 SELECT BeltPath.id, Port.id
                 FROM BeltPath
                    INNER JOIN Port ON Port.id = in_port_id
                 WHERE BeltPath.head_gap > 0
                   AND item IS NOT NULL;`
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

            new TickOp(
                "RecalculateNextGap",
                `WITH new_values (id, next_gap_id) AS (
                        SELECT path.id, MIN(gap.id)
                        FROM BeltPath path
                            INNER JOIN BeltPathItem gap ON gap.path_id = path.id AND gap.type = ${ITEM_TYPE_GAP}
                        GROUP BY path.id
                        HAVING MAX(path.next_gap_id) IS NULL OR MIN(gap.id) != MAX(path.next_gap_id)
                    )
                    UPDATE BeltPath
                        SET next_gap_id = new.next_gap_id
                    FROM new_values new
                    WHERE BeltPath.id = new.id;`
            ),

            new TickOp(
                "RecalculateNextItem",
                `WITH new_values (id, next_item_id) AS (
                        SELECT path.id, MIN(item.id)
                        FROM BeltPath path
                            INNER JOIN BeltPathItem item ON item.path_id = path.id AND item.type != ${ITEM_TYPE_GAP}
                        GROUP BY path.id
                        HAVING MAX(path.next_item_id) IS NULL OR MIN(item.id) != MAX(path.next_item_id)
                    )
                    UPDATE BeltPath
                        SET next_item_id = new.next_item_id
                    FROM new_values new
                    WHERE BeltPath.id = new.id;`
            )
        ],
        [TickPhase.COMMIT_TRANSFERS]: [
        ]
    },
);
