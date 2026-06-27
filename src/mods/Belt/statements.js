import {Direction} from "@/sdk/common.js";
import {
    BELT_NORMAL,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    ITEM_TYPE_GAP,
} from "./constants.js";

// ---- Direction aliases used in SQL templates ----
const UP = Direction.UP;
const RIGHT = Direction.RIGHT;
const DOWN = Direction.DOWN;
const LEFT = Direction.LEFT;

// Whether an upstream "parent" belt of type `parentType` may feed a downstream belt
// of type `childType` through a straight (in-line) connection. `parentType`/`childType`
// are SQL expressions (column refs or @params) so this composes into different queries.
const compatibleStraightConnection = (parentType, childType) => `(
       (${parentType}=${BELT_NORMAL}      AND ${childType}=${BELT_NORMAL})
    OR (${parentType}=${BELT_NORMAL}      AND ${childType}=${BELT_RAMP_DOWN})
    OR (${parentType}=${BELT_RAMP_DOWN}   AND ${childType}=${BELT_UNDERGROUND})
    OR (${parentType}=${BELT_RAMP_DOWN}   AND ${childType}=${BELT_RAMP_UP})
    OR (${parentType}=${BELT_UNDERGROUND} AND ${childType}=${BELT_UNDERGROUND})
    OR (${parentType}=${BELT_UNDERGROUND} AND ${childType}=${BELT_RAMP_UP})
    OR (${parentType}=${BELT_RAMP_UP}     AND ${childType}=${BELT_NORMAL}))`;

// As above for a bent (cornering) connection, where only normal-into-normal and
// ramp-up-into-normal are permitted.
const compatibleBentConnection = (parentType, childType) => `(
    (${parentType}=${BELT_NORMAL}  AND ${childType}=${BELT_NORMAL})
 OR (${parentType}=${BELT_RAMP_UP} AND ${childType}=${BELT_NORMAL}))`;

// Whether the belt downstream of a freshly placed belt (the "child") accepts it as
// its new upstream parent. `Belt` is the candidate child row; `@type`/`@direction`
// describe the belt being placed.
const CompatibleChildBeltConnection = `(
    (Belt.type = ${BELT_NORMAL} AND @type = ${BELT_NORMAL})
        OR (Belt.type = ${BELT_NORMAL} AND @type = ${BELT_RAMP_UP})
        OR (
            Belt.direction = @direction AND (
                (Belt.type = ${BELT_RAMP_DOWN}   AND @type = ${BELT_NORMAL})
             OR (Belt.type = ${BELT_NORMAL}      AND @type = ${BELT_RAMP_UP})
             OR (Belt.type = ${BELT_RAMP_UP}     AND @type = ${BELT_RAMP_DOWN})
             OR (Belt.type = ${BELT_UNDERGROUND} AND @type = ${BELT_RAMP_DOWN})
             OR (Belt.type = ${BELT_RAMP_UP}     AND @type = ${BELT_UNDERGROUND})
            )
        )
)`;

// The tile a belt at (@x, @y) facing @direction feeds into (its downstream "child"
// tile), and the direction a head-on belt there would face (excluded so two belts
// pointing at each other never connect).
const CHILD_TILE_X = `CASE
                    WHEN @direction = ${UP}    THEN @x
                    WHEN @direction = ${RIGHT} THEN @x + 1
                    WHEN @direction = ${DOWN}  THEN @x
                    WHEN @direction = ${LEFT}  THEN @x - 1
                END`;
const CHILD_TILE_Y = `CASE
                    WHEN @direction = ${UP}    THEN @y - 1
                    WHEN @direction = ${RIGHT} THEN @y
                    WHEN @direction = ${DOWN}  THEN @y + 1
                    WHEN @direction = ${LEFT}  THEN @y
                END`;
const OPPOSITE_DIRECTION = `CASE
                    WHEN @direction = ${UP}    THEN ${DOWN}
                    WHEN @direction = ${RIGHT} THEN ${LEFT}
                    WHEN @direction = ${DOWN}  THEN ${UP}
                    WHEN @direction = ${LEFT}  THEN ${RIGHT}
                END`;

/**
 * SQL `CASE` selecting MAX(id) of the belt that should feed a belt placed at (x, y) facing `direction`.
 * @param {object} o
 * @param {string} o.from - candidate table, e.g. "Belt" or "Belt b"
 * @param {string} o.col - candidate column prefix, e.g. "" or "b."
 * @param {string} o.x - origin x expression, e.g. "@x" or "Belt.x"
 * @param {string} o.y - origin y expression, e.g. "@y" or "Belt.y"
 * @param {string} o.direction - origin direction expression, e.g. "@direction" or "direction"
 * @param {string} o.placedType - fed belt's type expression, e.g. "@type" or "Belt.type"
 * @returns {string}
 */
function upstreamParentSql({from, col, x, y, direction, placedType}) {
    const straightAnd = ` AND ${compatibleStraightConnection(`${col}type`, placedType)}`;
    const bentAnd = ` AND ${compatibleBentConnection(`${col}type`, placedType)}`;
    const upstreamNeighbor = (fx, fy, dir, extra) =>
        `(${col}x = ${fx} AND ${col}y = ${fy} AND ${col}direction = ${dir}${extra})`;
    const select = (straightNeighbor, bentA, bentB) =>
        `(SELECT MAX(id) FROM ${from}
                         WHERE ${straightNeighbor}
                            OR ${bentA}
                            OR ${bentB})`;
    return `CASE
                    WHEN ${direction} = ${UP} THEN
                        ${select(
                            upstreamNeighbor(x, `${y} + 1`, UP, straightAnd),
                            upstreamNeighbor(`${x} - 1`, y, RIGHT, bentAnd),
                            upstreamNeighbor(`${x} + 1`, y, LEFT, bentAnd))}
                    WHEN ${direction} = ${RIGHT} THEN
                        ${select(
                            upstreamNeighbor(`${x} - 1`, y, RIGHT, straightAnd),
                            upstreamNeighbor(x, `${y} + 1`, UP, bentAnd),
                            upstreamNeighbor(x, `${y} - 1`, DOWN, bentAnd))}
                    WHEN ${direction} = ${DOWN} THEN
                        ${select(
                            upstreamNeighbor(x, `${y} - 1`, DOWN, straightAnd),
                            upstreamNeighbor(`${x} - 1`, y, RIGHT, bentAnd),
                            upstreamNeighbor(`${x} + 1`, y, LEFT, bentAnd))}
                    WHEN ${direction} = ${LEFT} THEN
                        ${select(
                            upstreamNeighbor(`${x} + 1`, y, LEFT, straightAnd),
                            upstreamNeighbor(x, `${y} + 1`, UP, bentAnd),
                            upstreamNeighbor(x, `${y} - 1`, DOWN, bentAnd))}
                END`;
}

// All four input-port lookups are identical: the belt at (@x, @y) is its own path
// head, so its in_port is read directly. portUtils dispatches by direction name
// (GetInPort${dir}), so all four keys must resolve to this statement.
const GetInPortAtTile = `
                SELECT in_port_id FROM BeltPath
                INNER JOIN Belt ON Belt.id = BeltPath.id
                WHERE Belt.x = @x AND Belt.y = @y
                LIMIT 1;
            `;

// The tail belt of a path is its lowest-path_index member. Shared so the standalone
// GetPathTailBelt op and MaterializeBeltPath's new_tail can never disagree.
const PATH_TAIL_BELT_SQL = "SELECT id FROM Belt WHERE path_id = CAST(@id AS INT) ORDER BY path_index LIMIT 1";

// Named prepared statements the Belt mod registers with the database.
// noinspection SqlWithoutWhere
export const beltStatements = {

    StashOutputItem: `
        INSERT INTO StashedOutputItem (belt_id, type)
        SELECT tail_id, p.item
        FROM BeltPath
            INNER JOIN Port p ON p.id = BeltPath.out_port_id
        WHERE BeltPath.id = CAST(@id AS INT)
          AND p.item IS NOT NULL;
    `,

    RemoveOutputItem: `
        UPDATE Port
        SET item=NULL
        FROM BeltPath
        WHERE BeltPath.id = CAST(@id AS INT)
          AND Port.id = BeltPath.out_port_id;
    `,

    UnStashOutputItem: `
        UPDATE Port
        SET item = StashedOutputItem.type
        FROM StashedOutputItem
            INNER JOIN Belt ON Belt.id = StashedOutputItem.belt_id
            INNER JOIN BeltPath ON BeltPath.id = Belt.path_id
        WHERE Port.id = BeltPath.out_port_id;
    `,

    TruncateStashedOutputItem: `DELETE FROM StashedOutputItem;`,

    StashGap: `
        INSERT INTO StashedItem (belt_id, type) VALUES
            (CAST(@id AS INT), ${ITEM_TYPE_GAP}),
            (CAST(@id AS INT), ${ITEM_TYPE_GAP});
    `,

    StashItems: `
        INSERT INTO StashedItem (belt_id, type)
        WITH items AS (
            SELECT
                path_id,
                type,
                length,
                coalesce(SUM(length) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS path_index
            FROM BeltPathItem
            WHERE path_id = CAST(@id AS INT)
            UNION ALL
            SELECT
                BeltPath.id AS path_id,
                ${ITEM_TYPE_GAP} AS type,
                head_gap AS length,
                length - head_gap AS path_index
            FROM BeltPath
            WHERE BeltPath.id = CAST(@id AS INT)
        ),
        items_exploded AS (
            SELECT path_id, type, path_index + value AS path_index
            FROM items
                CROSS JOIN Numbers
            WHERE value < items.length
        )
        SELECT Belt.id, items_exploded.type
        FROM items_exploded
            INNER JOIN Belt ON
                Belt.path_index = CAST(items_exploded.path_index / 2 AS INT)
                AND Belt.path_id = items_exploded.path_id
        ORDER BY items_exploded.path_index;
    `,

    DeleteItems: `
        DELETE FROM BeltPathItem
        WHERE path_id = CAST(@id AS INT);
    `,

    UnStashItems: `
        INSERT INTO BeltPathItem (path_id, length, type)
        WITH raw_items AS (
            SELECT Belt.id, Belt.path_id, item.type
            FROM StashedItem item
                INNER JOIN Belt ON Belt.id = item.belt_id
            ORDER BY Belt.path_index
        ),
        items AS (
            SELECT path_id,
                   type,
                   row_number() over () global_index
            FROM raw_items
        ),
        ranked_items AS (
            SELECT path_id,
                   type,
                   global_index,
                   row_number() over (PARTITION BY type ORDER BY global_index) group_index
            FROM items
        ),
        grouped_items AS (
            SELECT path_id,
                   COUNT(*) as length,
                   type,
                   SUM(type) OVER (PARTITION BY path_id) type_sum
            FROM ranked_items
            GROUP BY path_id, CASE WHEN type != ${ITEM_TYPE_GAP} THEN -global_index ELSE (global_index - group_index) END
            ORDER BY global_index
        )
        SELECT path_id, length, type
        FROM grouped_items
        WHERE type_sum > 0;
    `,

    TruncateStashedItems: `DELETE FROM StashedItem;`,

    FillHeadGap: `
        UPDATE BeltPath
        SET head_gap = length - COALESCE((SELECT SUM(length) FROM BeltPathItem WHERE path_id = CAST(@id AS INT)), 0)
        WHERE id = CAST(@id AS INT);
    `,

    // Shortening a path (a belt removed from a full run) can leave more item
    // content than the path can hold. Drop the head-most rows whose inclusion
    // would push the total past the path length, keeping the tail-side items
    // nearest the surviving downstream. Returns the dropped row ids.
    TrimOverflowItems: `
        WITH from_tail AS (
            SELECT id,
                SUM(length) OVER (ORDER BY id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS tail_total
            FROM BeltPathItem
            WHERE path_id = CAST(@id AS INT)
        ),
        path_length AS (SELECT length FROM BeltPath WHERE id = CAST(@id AS INT))
        DELETE FROM BeltPathItem
        WHERE id IN (
            SELECT from_tail.id
            FROM from_tail
                CROSS JOIN path_length
            WHERE from_tail.tail_total > path_length.length
        )
        RETURNING id;
    `,

    // After TrimOverflowItems, a gap can be left as the head-most row (highest
    // id) when the drop boundary fell just past it. Empty space at the head
    // belongs in head_gap, not a gap item — otherwise an entering item is
    // wrongly blocked — so remove any gap rows above the top-most real item;
    // FillHeadGap then reclaims that space.
    DropTrailingHeadGaps: `
        WITH last_item AS (
            SELECT COALESCE(MAX(id), 0) AS id
            FROM BeltPathItem
            WHERE path_id = CAST(@id AS INT) AND type != ${ITEM_TYPE_GAP}
        )
        DELETE FROM BeltPathItem
        WHERE id IN (
            SELECT gap.id
            FROM BeltPathItem gap
                CROSS JOIN last_item
            WHERE gap.path_id = CAST(@id AS INT)
              AND gap.type = ${ITEM_TYPE_GAP}
              AND gap.id > last_item.id
        );
    `,

    TransferBeltPathItems: `
        UPDATE BeltPathItem
        SET path_id = CAST(@to AS INT)
        WHERE path_id = CAST(@from AS INT);
    `,

    RecalculateNextGapForPath: `
        UPDATE BeltPath
        SET next_gap_id = (
            SELECT MIN(id)
            FROM BeltPathItem
            WHERE path_id = CAST(@id AS INT)
              AND type = ${ITEM_TYPE_GAP}
        )
        WHERE id = CAST(@id AS INT);
    `,

    RecalculateNextItemForPath: `
        UPDATE BeltPath
        SET next_item_id = (
            SELECT MIN(id)
            FROM BeltPathItem
            WHERE path_id = CAST(@id AS INT)
              AND type != ${ITEM_TYPE_GAP}
        )
        WHERE id = CAST(@id AS INT);
    `,

    // The next_gap recalc scoped to just the paths an un-stash touched (the
    // distinct paths of the stashed belts), so a create/delete never scans every
    // path in the world the way the global RecalculateNextGap tick op does.
    RecalculateNextGapForStashedPaths: `
        WITH stashed_paths AS (
            SELECT DISTINCT Belt.path_id AS id
            FROM StashedItem
                INNER JOIN Belt ON Belt.id = StashedItem.belt_id
        ),
        next_gaps AS (
            SELECT stashed_paths.id, MIN(gap.id) AS next_gap_id
            FROM stashed_paths
                LEFT JOIN BeltPathItem gap ON gap.path_id = stashed_paths.id AND gap.type = ${ITEM_TYPE_GAP}
            GROUP BY stashed_paths.id
        )
        UPDATE BeltPath
        SET next_gap_id = next_gaps.next_gap_id
        FROM next_gaps
        WHERE BeltPath.id = next_gaps.id;
    `,

    RecalculateNextItemForStashedPaths: `
        WITH stashed_paths AS (
            SELECT DISTINCT Belt.path_id AS id
            FROM StashedItem
                INNER JOIN Belt ON Belt.id = StashedItem.belt_id
        ),
        next_items AS (
            SELECT stashed_paths.id, MIN(item.id) AS next_item_id
            FROM stashed_paths
                LEFT JOIN BeltPathItem item ON item.path_id = stashed_paths.id AND item.type != ${ITEM_TYPE_GAP}
            GROUP BY stashed_paths.id
        )
        UPDATE BeltPath
        SET next_item_id = next_items.next_item_id
        FROM next_items
        WHERE BeltPath.id = next_items.id;
    `,

    // Returns the head of the newly inserted belt's path, the downstream child belt (if any),
    // and the old parent's path head (if the child had a previous parent in another path).
    GetBeltCreateContext: `
        WITH RECURSIVE
            head_path(id, parent_id, chunk) AS (
                SELECT id, parent_id, chunk FROM Belt WHERE id = CAST(@id AS INT)
                UNION
                SELECT p.id, p.parent_id, p.chunk
                FROM Belt p
                    INNER JOIN head_path ON head_path.parent_id = p.id AND head_path.chunk = p.chunk
            ),
            head AS (
                SELECT h.id
                FROM head_path h
                    LEFT JOIN head_path ancestor ON ancestor.id = h.parent_id
                WHERE ancestor.id IS NULL
            ),
            child AS (
                SELECT Belt.id, Belt.path_id, Belt.parent_id, Belt.chunk, Belt.x, Belt.y
                FROM Belt
                    -- Match the placed belt by id, not its tile: an underground tunnel
                    -- can share the tile, and joining it instead breaks the loop-back
                    -- check below (its grandparent is the tunnel, not the new path).
                    LEFT JOIN Belt new_parent ON new_parent.id = CAST(@id AS INT)
                    LEFT JOIN Belt new_grandparent  ON new_grandparent.id = new_parent.parent_id
                WHERE Belt.x = ${CHILD_TILE_X}
                  AND Belt.y = ${CHILD_TILE_Y}
                  AND Belt.direction != ${OPPOSITE_DIRECTION}
                  AND (new_grandparent.path_id IS NULL OR new_grandparent.path_id != Belt.id)
                  AND ${CompatibleChildBeltConnection}
            )
        SELECT
            -- the head of the path the new belt joined or created
            head.id                         AS head,

            -- the belt immediately downstream (NULL if none)
            child.id                        AS child_id,
            child.x                         AS child_x,
            child.y                         AS child_y,
            child.chunk                     AS child_chunk,
            -- child.path_id = child.id means child was a standalone path head
            child.path_id                   AS child_path,

            -- child's previous upstream parent before this insert (NULL if child had none)
            child.parent_id                 AS child_old_parent,
            child_old_parent.chunk          AS child_old_parent_chunk,
            -- the path that must be re-stashed/recalculated because it lost a member
            child_old_parent.path_id        AS old_parent_path_head
        FROM head
            LEFT JOIN child ON 1=1
            LEFT JOIN Belt child_old_parent ON child_old_parent.id = child.parent_id
    `,

    UpdateBeltChild: `
        UPDATE Belt
        SET parent_id = ${upstreamParentSql({
            from: "Belt b",
            col: "b.",
            x: "Belt.x",
            y: "Belt.y",
            direction: "direction",
            placedType: "Belt.type",
        })}
        WHERE id = CAST(@id AS INT)
        RETURNING 1;
    `,

    GetBelt: `
        SELECT belt.x, belt.y, belt.type, belt.direction, belt.parent_id, belt.chunk,
            parent.type AS parent_type
        FROM Belt belt
            LEFT JOIN Belt parent ON parent.id = belt.parent_id
        WHERE belt.id = CAST(@id AS INT);
    `,

    // Every belt in a chunk, with its parent's tile, to sync a newly-subscribed
    // client. Includes underground belts (no type filter): the client index keeps
    // them for the underground tool's pairing scan even though they aren't drawn.
    // Every belt in the chunk, grouped by path (head last) so one scan syncs both the
    // belt syncs and the path-debug overlay. A path lives entirely in one chunk (it is
    // split at chunk borders), so a chunk's belts hold whole paths.
    GetBeltsInChunk: `
        SELECT belt.id, belt.x, belt.y, belt.direction, belt.type, belt.path_id,
            parent.x AS parent_x, parent.y AS parent_y
        FROM Belt belt
            LEFT JOIN Belt parent ON parent.id = belt.parent_id
        WHERE belt.chunk = @chunk
        ORDER BY belt.path_id, belt.path_index;
    `,

    GetTail: `
        SELECT x, y, type, direction, parent_id, chunk
        FROM Belt
        WHERE id = (SELECT tail_id FROM BeltPath WHERE id = CAST(@id AS INT));
    `,

    GetBeltParent: `
        SELECT parent.id, parent.x, parent.y
        FROM Belt
            INNER JOIN Belt parent ON parent.id = Belt.parent_id
        WHERE Belt.id = CAST(@id AS INT)
        LIMIT 1;
    `,

    InsertBelt: `
        INSERT INTO Belt (parent_id, x, y, type, direction)
        VALUES (${upstreamParentSql({
            from: "Belt",
            col: "",
            x: "@x",
            y: "@y",
            direction: "@direction",
            placedType: "@type",
        })},
        @x, @y, @type, @direction)
        RETURNING Belt.id;
    `,

    GetBeltPathHead: `
        WITH RECURSIVE path AS (
            SELECT id, parent_id, chunk
            FROM Belt
            WHERE id = CAST(@id AS INT)

            UNION

            SELECT parent.id, parent.parent_id, parent.chunk
            FROM Belt parent
                INNER JOIN path ON path.parent_id = parent.id AND path.chunk = parent.chunk
        )
        SELECT id
        FROM path;
    `,

    CalculateBeltPath: `
        WITH parent_belt AS (
            SELECT id, chunk FROM Belt WHERE id = @id
        ), path AS (
            SELECT id, chunk FROM parent_belt
            UNION
            SELECT child.id, child.chunk
            FROM Belt child
                INNER JOIN path ON path.id = child.parent_id
            WHERE path.chunk = child.chunk
        ), indexed_path AS (
            SELECT id, ROW_NUMBER() OVER () idx FROM path
        ), reverse_path AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY idx DESC) - 1 seq FROM indexed_path
        )
        UPDATE Belt
        SET path_id=CASE WHEN Belt.id IN (SELECT id FROM reverse_path) THEN CAST(@id AS INT) ELSE NULL END,
            path_index=(
                SELECT seq FROM reverse_path 
                WHERE reverse_path.id = Belt.id
            )
        WHERE id IN (SELECT id FROM reverse_path)
           OR path_id = CAST(@id AS INT);
    `,

    MaterializeBeltPath: `
        WITH new_tail AS (${PATH_TAIL_BELT_SQL}),
             path_length AS (SELECT COUNT(*) * 2 - 1 AS length FROM Belt WHERE path_id = CAST(@id AS INT))
        UPDATE BeltPath
        SET tail_id  = (SELECT id FROM new_tail),
            length   = path_length.length,
            head_gap = path_length.length
        FROM path_length
        WHERE id = CAST(@id AS INT)
        RETURNING length;
    `,

    DeleteInPort: `
        DELETE FROM Port
        WHERE id = (SELECT in_port_id FROM BeltPath WHERE id = CAST(@id AS INT))
          AND NOT EXISTS (SELECT 1 FROM BeltPath WHERE out_port_id = Port.id);
    `,

    UpdateInPort: `
        UPDATE BeltPath
        SET in_port_id=CAST(@port AS INT)
        WHERE id = CAST(@id AS INT)
    `,

    // Flag a port as a path's in-port so the Port_in_filled partial index covers it.
    // Called wherever in_port_id is assigned; the flag is never cleared (a stale flag
    // only costs the index a row, never a wrong activation), and the Port row is
    // dropped outright when the path is removed.
    MarkPortAsInput: `
        UPDATE Port
        SET is_in_port=1
        WHERE id = CAST(@port AS INT)
    `,

    DeleteOutPort: `
        DELETE FROM Port
        WHERE id = (SELECT out_port_id FROM BeltPath WHERE id = CAST(@id AS INT))
    `,

    InheritOutPort: `
        UPDATE BeltPath
        SET out_port_id=(SELECT out_port_id FROM BeltPath WHERE id = CAST(@child AS INT))
        WHERE id = CAST(@parent AS INT)
          AND EXISTS (SELECT 1 FROM BeltPath WHERE id = CAST(@child AS INT) AND out_port_id IS NOT NULL)
        RETURNING out_port_id
    `,

    GetPathInPort: `SELECT in_port_id FROM BeltPath WHERE id = CAST(@id AS INT);`,

    GetPathOutPort: `SELECT out_port_id FROM BeltPath WHERE id = CAST(@id AS INT);`,

    GetBeltPath: `SELECT id FROM Belt WHERE path_id = CAST(@id AS INT) ORDER BY path_index;`,

    // Flag a path (its head id) for a full client item re-sync on the next tick.
    MarkPathForResync: `INSERT OR IGNORE INTO ResyncItemPath (path_id) VALUES (CAST(@id AS INT));`,

    // Flag every path with a belt in a chunk for re-sync, when a viewer subscribes to it.
    MarkChunkPathsForResync: `
        INSERT OR IGNORE INTO ResyncItemPath (path_id)
        SELECT DISTINCT path_id FROM Belt
        WHERE chunk = @chunk
          AND path_id IS NOT NULL;
    `,

    GetRampParents: `
        WITH RECURSIVE path AS (
            SELECT id, parent_id, type FROM Belt WHERE id = CAST(@id AS INT)
            UNION
            SELECT parent.id, parent.parent_id, parent.type
            FROM Belt parent
                INNER JOIN path ON path.parent_id = parent.id AND parent.type = ${BELT_UNDERGROUND}
        )
        SELECT id, parent_id
        FROM path
        WHERE type = ${BELT_UNDERGROUND};
    `,

    GetRampChildren: `
        WITH RECURSIVE path AS (
            SELECT id, type FROM Belt WHERE id = CAST(@id AS INT)
            UNION
            SELECT child.id, child.type
            FROM Belt child
                INNER JOIN path ON child.parent_id = path.id AND child.type = ${BELT_UNDERGROUND}
        )
        SELECT id
        FROM path
        WHERE type = ${BELT_UNDERGROUND};
    `,

    // The RAMP_UP a RAMP_DOWN entrance tunnels into: follows the child chain
    // (each belt's parent_id points at the one feeding it) downstream through the
    // buried undergrounds until the surfacing exit. Empty for a lone entrance.
    GetDownstreamRamp: `
        WITH RECURSIVE chain AS (
            SELECT id, type FROM Belt WHERE id = CAST(@id AS INT)
            UNION
            SELECT child.id, child.type
            FROM Belt child
                INNER JOIN chain ON child.parent_id = chain.id
                    AND chain.type IN (${BELT_RAMP_DOWN}, ${BELT_UNDERGROUND})
        )
        SELECT belt.id, belt.x, belt.y, belt.type, belt.direction
        FROM chain
            INNER JOIN Belt belt ON belt.id = chain.id
        WHERE chain.type = ${BELT_RAMP_UP}
        LIMIT 1;
    `,

    // The RAMP_DOWN entrance feeding a RAMP_UP exit: follows the parent chain
    // upstream through the buried undergrounds back to the entrance. Empty for a
    // lone exit.
    GetUpstreamRamp: `
        WITH RECURSIVE chain AS (
            SELECT id, parent_id, type FROM Belt WHERE id = CAST(@id AS INT)
            UNION
            SELECT parent.id, parent.parent_id, parent.type
            FROM Belt parent
                INNER JOIN chain ON chain.parent_id = parent.id
                    AND chain.type IN (${BELT_RAMP_UP}, ${BELT_UNDERGROUND})
        )
        SELECT belt.id, belt.x, belt.y, belt.type, belt.direction
        FROM chain
            INNER JOIN Belt belt ON belt.id = chain.id
        WHERE chain.type = ${BELT_RAMP_DOWN}
        LIMIT 1;
    `,

    // Every belt sitting on the @maxSteps tiles ahead of (@x, @y) along the
    // (@dx, @dy) axis step, tagged with its distance, nearest first. Drives the
    // server-side ramp pairing scan when a deletion orphans a tunnel partner.
    GetBeltsAlongAxis: `
        SELECT belt.id, belt.x, belt.y, belt.type, belt.direction, Numbers.value + 1 AS distance
        FROM Numbers
            INNER JOIN Belt belt
                ON belt.x = @x + @dx * (Numbers.value + 1)
               AND belt.y = @y + @dy * (Numbers.value + 1)
        WHERE Numbers.value + 1 <= @maxSteps
        ORDER BY distance;
    `,

    InsertBeltPath: `
        INSERT INTO BeltPath (id) VALUES (CAST(@id AS INT))
        ON CONFLICT DO NOTHING
        RETURNING 1 AS created;
    `,

    UpdateBeltPathPorts: `
        UPDATE BeltPath
        SET in_port_id=CAST(@inPort AS INT),
            out_port_id=CAST(@outPort AS INT)
        WHERE id = CAST(@id AS INT);
    `,

    GetBeltPathPortOwner: `SELECT id FROM BeltPath WHERE in_port_id = CAST(@id AS INT);`,

    GetOutPortUp: `
        SELECT out_port_id FROM BeltPath
        INNER JOIN Belt ON Belt.id = BeltPath.tail_id
        WHERE Belt.x = @x AND Belt.y = @y + 1 AND Belt.direction = ${UP};
    `,
    GetOutPortRight: `
        SELECT out_port_id FROM BeltPath
        INNER JOIN Belt ON Belt.id = BeltPath.tail_id
        WHERE Belt.x = @x - 1 AND Belt.y = @y AND Belt.direction = ${RIGHT};
    `,
    GetOutPortDown: `
        SELECT out_port_id FROM BeltPath
        INNER JOIN Belt ON Belt.id = BeltPath.tail_id
        WHERE Belt.x = @x AND Belt.y = @y - 1 AND Belt.direction = ${DOWN};
    `,
    GetOutPortLeft: `
        SELECT out_port_id FROM BeltPath
        INNER JOIN Belt ON Belt.id = BeltPath.tail_id
        WHERE Belt.x = @x + 1 AND Belt.y = @y AND Belt.direction = ${LEFT};
    `,

    GetInPortUp: GetInPortAtTile,
    GetInPortRight: GetInPortAtTile,
    GetInPortDown: GetInPortAtTile,
    GetInPortLeft: GetInPortAtTile,

    DeletePath: `
        DELETE FROM BeltPath
        WHERE id = CAST(@id AS INT)
    `,

    InvalidatePath: `
        UPDATE BeltPath
        SET tail_id=NULL,
            length=NULL,
            next_gap_id=NULL,
            next_item_id=NULL
        WHERE id = CAST(@id AS INT)
    `,

    DeleteUnusedPathPorts: `
        DELETE FROM Port
        WHERE id IN (
            SELECT in_port_id  FROM BeltPath WHERE id = CAST(@id AS INT)
            UNION ALL
            SELECT out_port_id FROM BeltPath WHERE id = CAST(@id AS INT)
        )
        AND NOT EXISTS (
            SELECT 1 FROM BeltPath
            WHERE id != CAST(@id AS INT) AND (in_port_id=Port.id OR out_port_id=Port.id)
            UNION ALL
            SELECT 1 FROM Splitter
            WHERE in_port_a_id=Port.id OR in_port_b_id=Port.id
               OR out_port_a_id=Port.id OR out_port_b_id=Port.id
               OR int_port_a_id=Port.id OR int_port_b_id=Port.id
        );
    `,

    DetachChild: `
        UPDATE Belt
        SET parent_id=NULL
        WHERE parent_id = CAST(@id AS INT)
        RETURNING id, x, y;
    `,

    NullifyParent: `
        UPDATE Belt
        SET parent_id=NULL
        WHERE id = CAST(@id AS INT);
    `,

    UnassignBeltPath: `
        UPDATE Belt
        SET path_id=NULL, path_index=NULL
        WHERE path_id=CAST(@id AS INT);
    `,

    ClearSolitaryBeltPortItem: `
        UPDATE Port SET item=NULL
        FROM BeltPath path
        WHERE Port.id=path.out_port_id AND path.id=@id AND path.tail_id=path.id;
    `,

    NullifyPathTail: `
        UPDATE BeltPath SET tail_id=NULL
        WHERE tail_id=CAST(@id AS INT);
    `,

    // The belt that would be the tail (lowest path_index) of @id's path.
    GetPathTailBelt: `${PATH_TAIL_BELT_SQL};`,

    // The belt physically upstream of head @id (same geometry InsertBelt uses
    // to pick a new belt's parent). Used to detect/heal a loop seam: a head
    // whose upstream neighbor lives in a different path is a loop broken elsewhere.
    // Aliased `id` so it narrows to BigInt like every other belt id.
    FindUpstreamNeighbor: `
        SELECT ${upstreamParentSql({
            from: "Belt upstream_neighbor",
            col: "upstream_neighbor.",
            x: "H.x",
            y: "H.y",
            direction: "H.direction",
            placedType: "H.type",
        })} AS id
        FROM Belt H
        WHERE H.id = CAST(@id AS INT);
    `,

    DeleteBeltRow: `
        DELETE FROM Belt
        WHERE id = CAST(@id AS INT)
        RETURNING parent_id;
    `,
};
