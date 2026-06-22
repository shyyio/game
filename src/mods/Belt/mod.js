
import {
    Mod,
    ObjectDefinition,
    PortDefinition,
    TickOp,
    TickPhase,
    LiveEvent,
    Direction,
    CHUNK_KEY_SQL,
    chunkKey,
    upstreamPorts,
    downstreamPorts,
} from "@/sdk/common.js";
import {CreateBeltMessage, DeleteBeltMessage} from "@/mods/Belt/messages.js";

// Maximum number of tiles an underground belt may span.
export const MAX_UNDERGROUND_LENGTH = 6;

/**
 * Game-setting keys this mod owns (core owns key 0; see GameSettingsKey).
 * @enum
 */
const BeltGameSettingsKey = {
    MAX_UNDERGROUND_LENGTH: 1,
};

// ---- Belt types ----
const BELT_NORMAL = 0;
const BELT_RAMP_DOWN = 1;
const BELT_RAMP_UP = 2;
const BELT_UNDERGROUND = 3;

export const BeltType = {
    NORMAL: BELT_NORMAL,
    RAMP_DOWN: BELT_RAMP_DOWN,
    RAMP_UP: BELT_RAMP_UP,
    UNDERGROUND: BELT_UNDERGROUND,
};

export const BeltBend = {
    STRAIGHT: 0,
    LEFT: 1,
    RIGHT: 2,
};

// ---- Item types ----
const ITEM_TYPE_GAP = 0;
const ITEM_FLAG_STASHED = 1;

// ---- Event types ----
const EVENT_BELT_DELETE = 1;
const EVENT_BELT_INSERT = 2;
const EVENT_BELT_UPDATE = 3;
const EVENT_BELT_PATH_RECALCULATE = 4;

export class BeltPathRecalculateEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
        parts: "int64[]",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt[]} parts - Belt IDs in path order, head last
     */
    constructor(x, y, parts) {
        super(EVENT_BELT_PATH_RECALCULATE, x, y);
        this.parts = parts;
    }
}

export class BeltInsertEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
        id: "int64",
        direction: "int32",
        beltType: "int32",
        parentX: "int32?",
        parentY: "int32?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {number} direction
     * @param {number} beltType
     * @param {number|null} parentX
     * @param {number|null} parentY
     */
    constructor(x, y, id, direction, beltType, parentX, parentY) {
        super(EVENT_BELT_INSERT, x, y);
        this.id = id;
        this.direction = direction;
        this.beltType = beltType;
        this.parentX = parentX === undefined ? null : parentX;
        this.parentY = parentY === undefined ? null : parentY;
    }
}

export class BeltUpdateEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
        id: "int64",
        newParentX: "int32?",
        newParentY: "int32?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {number|null} newParentX
     * @param {number|null} newParentY
     */
    constructor(x, y, id, newParentX, newParentY) {
        super(EVENT_BELT_UPDATE, x, y);
        this.id = id;
        this.newParentX = newParentX;
        this.newParentY = newParentY;
    }
}

export class BeltDeleteEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
        id: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     */
    constructor(x, y, id) {
        super(EVENT_BELT_DELETE, x, y);
        this.id = id;
    }
}
// ---- Underground belt helpers ----

/**
 * @param rampParent {{x: number, y: number, type: number, direction: Direction}}
 * @param options {{x: number, y: number, type: number, direction: Direction}}
 * @returns {{x: number, y: number}[]}
 */
function getUndergroundBeltsToCreate(rampParent, options) {
    if (rampParent === null || rampParent.direction !== options.direction
        || (rampParent.type !== BELT_RAMP_DOWN && rampParent.type !== BELT_RAMP_UP)
        || (rampParent.x !== options.x && rampParent.y !== options.y)) {
        throw new Error("Invalid ramp parent for underground belt creation");
    }

    const x1 = rampParent.type === BELT_RAMP_UP ? options.x : rampParent.x;
    const y1 = rampParent.type === BELT_RAMP_UP ? options.y : rampParent.y;
    let x2 = rampParent.type === BELT_RAMP_UP ? rampParent.x : options.x;
    let y2 = rampParent.type === BELT_RAMP_UP ? rampParent.y : options.y;

    const dx = x2 === x1 ? 0 : x2 < x1 ? -1 : 1;
    const dy = y2 === y1 ? 0 : y2 < y1 ? -1 : 1;

    x2 -= dx;
    y2 -= dy;

    let x = x1;
    let y = y1;

    const undergrounds = [];
    while (x !== x2 || y !== y2) {
        x += dx;
        y += dy;
        undergrounds.push({x, y});
    }

    if (undergrounds.length > MAX_UNDERGROUND_LENGTH) {
        return [];
    }

    return undergrounds;
}

// ---- Direction aliases used in SQL templates ----
const UP = Direction.UP;
const RIGHT = Direction.RIGHT;
const DOWN = Direction.DOWN;
const LEFT = Direction.LEFT;

const CompatibleStraightBeltConnection = `(
       (type=${BELT_NORMAL}      AND @type=${BELT_NORMAL})
    OR (type=${BELT_NORMAL}      AND @type=${BELT_RAMP_DOWN})
    OR (type=${BELT_RAMP_DOWN}   AND @type=${BELT_UNDERGROUND})
    OR (type=${BELT_RAMP_DOWN}   AND @type=${BELT_RAMP_UP})
    OR (type=${BELT_UNDERGROUND} AND @type=${BELT_UNDERGROUND})
    OR (type=${BELT_UNDERGROUND} AND @type=${BELT_RAMP_UP})
    OR (type=${BELT_RAMP_UP}     AND @type=${BELT_NORMAL}))`;

const CompatibleBentBeltConnection = `(
    (type=${BELT_NORMAL}  AND @type=${BELT_NORMAL})
 OR (type=${BELT_RAMP_UP} AND @type=${BELT_NORMAL}))`;

// noinspection SqlWithoutWhere
export class BeltMod extends Mod {

    get wireClasses() {
        return [
            CreateBeltMessage,
            DeleteBeltMessage,
            BeltInsertEvent,
            BeltUpdateEvent,
            BeltDeleteEvent,
            BeltPathRecalculateEvent,
        ];
    }

    get schema() {
        return `
            CREATE TABLE BeltPath (
                id INTEGER PRIMARY KEY REFERENCES Belt(id),
                tail_id INT UNIQUE REFERENCES Belt(id),
                length INT,

                head_gap INT
                    CHECK (head_gap >= 0 AND head_gap <= length),

                in_port_id INT REFERENCES Port(id) ON DELETE SET NULL
                    CHECK (in_port_id IS NULL OR in_port_id != out_port_id),

                out_port_id INT REFERENCES Port(id) ON DELETE SET NULL
                    CHECK (out_port_id IS NULL OR in_port_id != out_port_id),

                next_gap_id INT,
                next_item_id INT
            );
            CREATE INDEX BeltPath_ports ON BeltPath(in_port_id, out_port_id);

            CREATE TABLE Belt (
                id INTEGER PRIMARY KEY,
                parent_id INT UNIQUE REFERENCES Belt(id)
                    CHECK ( parent_id IS NULL OR parent_id != id ),

                path_id INT REFERENCES BeltPath,
                path_index INT,

                x INT NOT NULL,
                y INT NOT NULL,
                type INT NOT NULL
                    CHECK (type >= 0),

                chunk TEXT GENERATED ALWAYS AS (${CHUNK_KEY_SQL}) VIRTUAL,

                direction INT NOT NULL
            );

            CREATE UNIQUE INDEX Belt_x_y_surface    ON Belt(x, y) WHERE type != ${BELT_UNDERGROUND};
            CREATE UNIQUE INDEX Belt_x_y_underground ON Belt(x, y) WHERE type =  ${BELT_UNDERGROUND};
            CREATE INDEX Belt_path ON Belt(path_id, path_index);

            CREATE TABLE BeltPathItem (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                path_id INT NOT NULL REFERENCES BeltPath,
                length INT NOT NULL CHECK (length >= 0),

                type INT NOT NULL CHECK (type >= 0)
            );

            CREATE INDEX BeltPathItem_gap ON BeltPathItem(path_id, id) WHERE type = ${ITEM_TYPE_GAP};
            CREATE INDEX BeltPathItem_item ON BeltPathItem(path_id, id) WHERE type != ${ITEM_TYPE_GAP};
        `;
    }

    get definitions() {
        return {

            Belt: new ObjectDefinition(
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
                                    HAVING path.next_gap_id IS NULL OR MIN(gap.id) != MAX(path.next_gap_id)
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
                                    HAVING path.next_item_id IS NULL OR MIN(item.id) != MAX(path.next_item_id)
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
            ),
        };
    }

    get tempSchema() {
        return `
            CREATE TEMPORARY TABLE StashedItem (
                id INTEGER PRIMARY KEY,
                belt_id INT,
                type INT
            );

            CREATE TEMPORARY TABLE StashedOutputItem (
                id INTEGER PRIMARY KEY,
                belt_id INT,
                type INT
            );

            CREATE TEMPORARY TABLE BeltPathInputItem (
                path_id INT,
                port_id INT
            );

            CREATE TEMPORARY TABLE BeltPathOutputItem (
                path_id INTEGER PRIMARY KEY,
                port_id INT NOT NULL,
                item_id INT NOT NULL,
                item_type INT NOT NULL
            );

            INSERT INTO GameSettings (key, value) VALUES
                (${BeltGameSettingsKey.MAX_UNDERGROUND_LENGTH}, ${MAX_UNDERGROUND_LENGTH});
        `;
    }

    get statements() {
        return {

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
                        coalesce(SUM(length) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW EXCLUDE CURRENT ROW), 0) AS path_index
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
                            LEFT JOIN Belt new_parent       ON new_parent.x = @x AND new_parent.y = @y
                            LEFT JOIN Belt new_grandparent  ON new_grandparent.id = new_parent.parent_id
                        WHERE Belt.x = CASE
                            WHEN @direction = ${UP}    THEN @x
                            WHEN @direction = ${RIGHT} THEN @x + 1
                            WHEN @direction = ${DOWN}  THEN @x
                            WHEN @direction = ${LEFT}  THEN @x - 1
                        END
                          AND Belt.y = CASE
                            WHEN @direction = ${UP}    THEN @y - 1
                            WHEN @direction = ${RIGHT} THEN @y
                            WHEN @direction = ${DOWN}  THEN @y + 1
                            WHEN @direction = ${LEFT}  THEN @y
                        END
                          AND Belt.direction != CASE
                            WHEN @direction = ${UP}    THEN ${DOWN}
                            WHEN @direction = ${RIGHT} THEN ${LEFT}
                            WHEN @direction = ${DOWN}  THEN ${UP}
                            WHEN @direction = ${LEFT}  THEN ${RIGHT}
                        END
                          AND (new_grandparent.path_id IS NULL OR new_grandparent.path_id != Belt.id)
                          AND (
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
                        )
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

            GetBeltChild: `
                SELECT Belt.id,
                       Belt.path_id,
                       Belt.parent_id       oldParent,
                       Belt.chunk,
                       current_parent.chunk oldParentChunk,
                       Belt.x,
                       Belt.y
                FROM Belt
                    LEFT JOIN Belt current_parent ON Belt.parent_id = current_parent.id
                    LEFT JOIN Belt new_parent ON new_parent.x = @x AND new_parent.y = @y
                    LEFT JOIN Belt new_grandparent ON new_grandparent.id = new_parent.parent_id
                WHERE Belt.x = CASE
                    WHEN @direction = ${UP}    THEN @x
                    WHEN @direction = ${RIGHT} THEN @x + 1
                    WHEN @direction = ${DOWN}  THEN @x
                    WHEN @direction = ${LEFT}  THEN @x - 1
                END
                  AND Belt.y = CASE
                    WHEN @direction = ${UP}    THEN @y - 1
                    WHEN @direction = ${RIGHT} THEN @y
                    WHEN @direction = ${DOWN}  THEN @y + 1
                    WHEN @direction = ${LEFT}  THEN @y
                END
                  AND Belt.direction != CASE
                    WHEN @direction = ${UP}    THEN ${DOWN}
                    WHEN @direction = ${RIGHT} THEN ${LEFT}
                    WHEN @direction = ${DOWN}  THEN ${UP}
                    WHEN @direction = ${LEFT}  THEN ${RIGHT}
                END
                  AND (new_grandparent.path_id IS NULL OR new_grandparent.path_id != Belt.id)
                  AND (
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
                )
            `,

            UpdateBeltChild: `
                UPDATE Belt
                SET parent_id = CASE
                    WHEN direction = ${UP} THEN
                        (SELECT MAX(id) FROM Belt b
                         WHERE (b.x = Belt.x AND b.y = Belt.y + 1 AND b.direction = ${UP})
                            OR (b.x = Belt.x - 1 AND b.y = Belt.y AND b.direction = ${RIGHT})
                            OR (b.x = Belt.x + 1 AND b.y = Belt.y AND b.direction = ${LEFT}))
                    WHEN direction = ${RIGHT} THEN
                        (SELECT MAX(id) FROM Belt b
                         WHERE (b.x = Belt.x - 1 AND b.y = Belt.y AND b.direction = ${RIGHT})
                            OR (b.x = Belt.x AND b.y = Belt.y + 1 AND b.direction = ${UP})
                            OR (b.x = Belt.x AND b.y = Belt.y - 1 AND b.direction = ${DOWN}))
                    WHEN direction = ${DOWN} THEN
                        (SELECT MAX(id) FROM Belt b
                         WHERE (b.x = Belt.x AND b.y = Belt.y - 1 AND b.direction = ${DOWN})
                            OR (b.x = Belt.x - 1 AND b.y = Belt.y AND b.direction = ${RIGHT})
                            OR (b.x = Belt.x + 1 AND b.y = Belt.y AND b.direction = ${LEFT}))
                    WHEN direction = ${LEFT} THEN
                        (SELECT MAX(id) FROM Belt b
                         WHERE (b.x = Belt.x + 1 AND b.y = Belt.y AND b.direction = ${LEFT})
                            OR (b.x = Belt.x AND b.y = Belt.y + 1 AND b.direction = ${UP})
                            OR (b.x = Belt.x AND b.y = Belt.y - 1 AND b.direction = ${DOWN}))
                END
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

            GetBeltAtTile: `SELECT id FROM Belt WHERE x = @x AND y = @y LIMIT 1;`,

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
                VALUES (CASE
                    WHEN @direction = ${UP} THEN
                        (SELECT MAX(id) FROM Belt
                         WHERE (x = @x AND y = @y + 1 AND direction = ${UP} AND ${CompatibleStraightBeltConnection})
                            OR (x = @x - 1 AND y = @y AND direction = ${RIGHT} AND ${CompatibleBentBeltConnection})
                            OR (x = @x + 1 AND y = @y AND direction = ${LEFT} AND ${CompatibleBentBeltConnection}))
                    WHEN @direction = ${RIGHT} THEN
                        (SELECT MAX(id) FROM Belt
                         WHERE (x = @x - 1 AND y = @y AND direction = ${RIGHT} AND ${CompatibleStraightBeltConnection})
                            OR (x = @x AND y = @y + 1 AND direction = ${UP} AND ${CompatibleBentBeltConnection})
                            OR (x = @x AND y = @y - 1 AND direction = ${DOWN} AND ${CompatibleBentBeltConnection}))
                    WHEN @direction = ${DOWN} THEN
                        (SELECT MAX(id) FROM Belt
                         WHERE (x = @x AND y = @y - 1 AND direction = ${DOWN} AND ${CompatibleStraightBeltConnection})
                            OR (x = @x - 1 AND y = @y AND direction = ${RIGHT} AND ${CompatibleBentBeltConnection})
                            OR (x = @x + 1 AND y = @y AND direction = ${LEFT} AND ${CompatibleBentBeltConnection}))
                    WHEN @direction = ${LEFT} THEN
                        (SELECT MAX(id) FROM Belt
                         WHERE (x = @x + 1 AND y = @y AND direction = ${LEFT} AND ${CompatibleStraightBeltConnection})
                            OR (x = @x AND y = @y + 1 AND direction = ${UP} AND ${CompatibleBentBeltConnection})
                            OR (x = @x AND y = @y - 1 AND direction = ${DOWN} AND ${CompatibleBentBeltConnection}))
                END,
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

            GetExistingBeltPathHead: `
                SELECT path_id
                FROM Belt
                WHERE id = CAST(@id AS INT)
            `,

            CalculateBeltPath: `
                WITH parent_belt AS (SELECT id, chunk FROM Belt WHERE id = @id),
                     path AS (
                        SELECT id, chunk FROM parent_belt
                        UNION
                        SELECT child.id, child.chunk
                        FROM Belt child
                            INNER JOIN path ON path.id = child.parent_id
                        WHERE path.chunk = child.chunk
                     ),
                     indexed_path AS (SELECT id, row_number() over () idx FROM path),
                     reverse_path AS (SELECT id, ROW_NUMBER() OVER (ORDER BY idx DESC) - 1 seq FROM indexed_path)
                UPDATE Belt
                SET path_id=CAST(@id AS INT),
                    path_index=(SELECT seq FROM reverse_path WHERE reverse_path.id = Belt.id)
                WHERE id IN (SELECT id FROM reverse_path);
            `,

            MaterializeBeltPath: `
                WITH new_tail AS (SELECT id FROM Belt WHERE path_id = CAST(@id AS INT) ORDER BY path_index LIMIT 1),
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

            GetBeltPath: `SELECT id FROM Belt WHERE path_id = CAST(@id AS INT) ORDER BY path_index;`,

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

            GetInPortUp: `
                SELECT in_port_id FROM BeltPath
                INNER JOIN Belt ON Belt.id = BeltPath.id
                WHERE Belt.x = @x AND Belt.y = @y
                LIMIT 1;
            `,
            GetInPortRight: `
                SELECT in_port_id FROM BeltPath
                INNER JOIN Belt ON Belt.id = BeltPath.id
                WHERE Belt.x = @x AND Belt.y = @y
                LIMIT 1;
            `,
            GetInPortDown: `
                SELECT in_port_id FROM BeltPath
                INNER JOIN Belt ON Belt.id = BeltPath.id
                WHERE Belt.x = @x AND Belt.y = @y
                LIMIT 1;
            `,
            GetInPortLeft: `
                SELECT in_port_id FROM BeltPath
                INNER JOIN Belt ON Belt.id = BeltPath.id
                WHERE Belt.x = @x AND Belt.y = @y
                LIMIT 1;
            `,

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

            // TODO: DeleteUnusedPathPorts should be generated by DatabaseSchema based on all mod definitions.
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
                RETURNING id;
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

            DeleteBeltRow: `
                DELETE FROM Belt
                WHERE id = CAST(@id AS INT)
                RETURNING parent_id;
            `,
        };
    }

    // ---- Message handling ----

    onMessage(message) {
        if (message instanceof CreateBeltMessage) {
            this._createBelt({
                x: message.x,
                y: message.y,
                direction: message.direction,
                type: message.beltType,
                rampParent: message.rampParent,
                disconnectRampChild: message.disconnectRampChild,
            });
        } else if (message instanceof DeleteBeltMessage) {
            this._removeBelt(message.id);
        }
    }

    // ---- Belt creation ----

    /**
     * @private
     * @param {{x: number, y: number, type: number, direction: Direction, [rampParent]: BigInt, [disconnectRampChild]: BigInt, [chunk]: string}} options
     * @param {boolean} tnx
     */
    _createBelt(options, tnx=true) {
        options.chunk = chunkKey(options.x, options.y);
        if (tnx) {
            this.game.begin();
        }

        if (options.disconnectRampChild) {
            this._disconnectRampChain(options);
        }
        if (options.rampParent && (options.type === BELT_RAMP_UP || options.type === BELT_RAMP_DOWN)) {
            this._createUndergrounds(options);
        }

        let id;
        try {
            id = this.game.queryScalar("InsertBelt", options);
        } catch (e) {
            this.game.rollback();
            const msg = String(e);
            if (msg.includes("Belt.x") && msg.includes("Belt.y")) {
                console.warn("CreateBelt ignored: belt already exists at", options.x, options.y);
                return;
            }
            if (msg.includes("Belt.parent_id")) {
                console.warn("CreateBelt ignored: conflicting parent at", options.x, options.y);
                return;
            }
            throw new Error("FIXME: InsertBelt");
        }

        const {
            head,
            child_id: childId,
            child_x: childX,
            child_y: childY,
            child_chunk: childChunk,
            child_path: childPath,
            child_old_parent: childOldParent,
            child_old_parent_chunk: childOldParentChunk,
            old_parent_path_head: oldParentPathHead,
        } = this.game.querySingle("GetBeltCreateContext", {id, ...options});

        let child = null;
        if (childId !== null) {
            child = {
                id: childId,
                x: childX,
                y: childY,
                chunk: childChunk,
                path: childPath,
                oldParent: childOldParent,
                oldParentChunk: childOldParentChunk,
            };
        }

        // =========== Simple case: new head merging with standalone child in same chunk =====
        // No stash needed — child's path_indexes are unchanged; items transfer directly.
        if (child !== null
            && head === id
            && child.path === child.id
            && child.oldParent === null
            && child.chunk === options.chunk) {
            this.game.exec("UpdateBeltChild", {id: child.id});
            this.game.publishEventNow(new BeltUpdateEvent(child.x, child.y, child.id, options.x, options.y));

            const createdNewPath = this.game.queryScalar("InsertBeltPath", {id: head});
            this.game.exec("CalculateBeltPath", {id: head});
            this.game.exec("TransferBeltPathItems", {from: child.id, to: head});
            this.game.exec("DeleteOutPort", {id: head});

            const inheritedOutPort = this.game.queryScalar("InheritOutPort", {child: child.id, parent: head});

            this.game.exec("DeleteInPort", {id: child.id});
            this.game.exec("DeletePath", {id: child.id});
            this.game.exec("MaterializeBeltPath", {id: head});

            if (createdNewPath) {
                this._populateBeltPathPorts(head, inheritedOutPort);
            }
            this.game.exec("FillHeadGap", {id: head});
            this.game.exec("RecalculateNextGapForPath", {id: head});
            this.game.exec("RecalculateNextItemForPath", {id: head});

            const headPath = this._getPath(head);
            this.game.publishEventNow(new BeltPathRecalculateEvent(options.x, options.y, headPath));
            this._publishBeltInsert(id, options);

            if (tnx) {
                this.game.end();
            }
            return;
        }

        // =========== General case =====

        if (child !== null) {
            this.game.exec("UpdateBeltChild", {id: child.id});
            this.game.publishEventNow(new BeltUpdateEvent(child.x, child.y, child.id, options.x, options.y));

            this._stashItems(child.id);

            if (child.path === child.id) {
                this._stashOutputItem(child.id);
            }

            if (child.oldParent) {
                this._stashItems(oldParentPathHead);
                this._stashOutputItem(oldParentPathHead);

                this.game.exec("CalculateBeltPath", {id: oldParentPathHead});
                this.game.exec("InvalidatePath", {id: oldParentPathHead});
            }

            if (child.chunk !== options.chunk) {
                const created = this.game.queryScalar("InsertBeltPath", {id: child.id});
                this.game.exec("CalculateBeltPath", {id: child.id});
                this.game.exec("MaterializeBeltPath", {id: child.id});

                if (created) {
                    this._populateBeltPathPorts(child.id);
                }
                const childPath = this._getPath(child.id);
                this.game.publishEventNow(new BeltPathRecalculateEvent(child.x, child.y, childPath));
            }
        }

        if (child !== null || head !== id) {
            this.game.exec("StashGap", {id});
            this._stashItems(head);
        }

        const createdNewPath = this.game.queryScalar("InsertBeltPath", {id: head});
        this.game.exec("CalculateBeltPath", {id: head});

        // =========== Delete old path =====
        let inheritedOutPort = null;
        if (child !== null
            && (child.oldParent === null || child.oldParentChunk !== child.chunk)
            && child.id !== head
            && child.chunk === options.chunk) {
            this.game.exec("DeleteOutPort", {id: head});
            inheritedOutPort = this.game.queryScalar("InheritOutPort", {child: child.id, parent: head});
            this.game.exec("DeleteInPort", {id: child.id});
            this.game.exec("DeletePath", {id: child.id});
        }

        // =========== Materialize paths =====
        this.game.exec("MaterializeBeltPath", {id: head});
        if (createdNewPath) {
            this._populateBeltPathPorts(head, inheritedOutPort);
        }
        const headPath = this._getPath(head);
        this.game.publishEventNow(new BeltPathRecalculateEvent(options.x, options.y, headPath));

        if (oldParentPathHead) {
            this.game.exec("MaterializeBeltPath", {id: oldParentPathHead});
            const oldParentPath = this._getPath(oldParentPathHead);
            this.game.publishEventNow(new BeltPathRecalculateEvent(options.x, options.y, oldParentPath));
        }

        // =========== Un-stash ============
        this._unStashItems();

        if (oldParentPathHead) {
            this.game.exec("FillHeadGap", {id: oldParentPathHead});
        }
        this.game.exec("FillHeadGap", {id: head});

        if (child !== null && (child.oldParent || child.path === child.id)) {
            this._unStashOutputItem();
            this.game.exec("FillHeadGap", {id: child.id});
        }

        this._publishBeltInsert(id, options);

        if (tnx) {
            this.game.end();
        }
    }

    /**
     * @private
     * @param {{x: number, y: number, type: number, rampParent: BigInt, disconnectRampChild: BigInt}} options
     */
    _disconnectRampChain(options) {
        if (!options.rampParent || (options.type !== BELT_RAMP_UP && options.type !== BELT_RAMP_DOWN)) {
            this.game.rollback();
            throw new Error("belt error");
        }

        const rampChild = this.game.querySingle("GetBelt", {id: options.disconnectRampChild});
        if (!rampChild || rampChild.type !== options.type) {
            this.game.rollback();
            throw new Error("belt error");
        }

        const distanceX = Math.abs(options.x - rampChild.x);
        const distanceY = Math.abs(options.y - rampChild.y);
        if ((distanceX !== 0 && distanceY !== 0)
            || (Math.max(distanceX, distanceY) - 2) > MAX_UNDERGROUND_LENGTH) {
            this.game.rollback();
            throw new Error("belt error");
        }

        if (options.type === BELT_RAMP_DOWN) {
            const rampBelts = this.game.query("GetRampChildren", {id: options.disconnectRampChild});
            rampBelts.forEach(belt => this._removeBelt(belt.id, true));
        } else {
            const rampBelts = this.game.query("GetRampParents", {id: options.disconnectRampChild});
            rampBelts.forEach(belt => this._removeBelt(belt.id, true));
        }
    }

    /**
     * @private
     * @param {{x: number, y: number, direction: Direction, type: number, rampParent: BigInt}} options
     */
    _createUndergrounds(options) {
        const rampParent = this.game.querySingle("GetBelt", {id: options.rampParent});
        const undergrounds = getUndergroundBeltsToCreate(rampParent, options);
        undergrounds.forEach(underground => {
            this._createBelt({
                x: underground.x,
                y: underground.y,
                direction: options.direction,
                type: BELT_UNDERGROUND,
            }, false);
        });
    }

    // ---- Belt removal ----

    /**
     * @private
     * @param {BigInt} id
     * @param {boolean} [recursive]
     * @param {BigInt[]} [fillHeadGap]
     */
    _removeBelt(id, recursive=false, fillHeadGap=[]) {
        if (!recursive) {
            this.game.begin();
        }

        const belt = this.game.querySingle("GetBelt", {id});
        if (belt == null) {
            console.warn("DeleteBelt ignored: no belt with id", id);
            if (!recursive) {
                this.game.rollback();
            }
            return;
        }

        this._stashOutputItem(id);
        if (belt.type === BELT_UNDERGROUND && !recursive) {
            this.game.end();
            throw new Error("Cannot manually delete underground belt.");
        }

        let {childId, parentId} = this._eraseBelt(id);
        this.game.publishEventNow(new BeltDeleteEvent(belt.x, belt.y, id));

        // When deleting a RAMP_UP with multiple underground belts, all undergrounds share the
        // same path head. Only the innermost underground (whose parent is not underground) should
        // manage the parent path head — otherwise each deletion stashes items independently and
        // the accumulated stash exceeds the recalculated path length, violating the head_gap
        // constraint.
        if (belt.type === BELT_UNDERGROUND && recursive && belt.parent_type === BELT_UNDERGROUND) {
            parentId = null;
        }

        if (belt.type === BELT_RAMP_DOWN) {
            const rampBelts = this.game.query("GetRampChildren", {id: childId});
            rampBelts.forEach(child => {
                this._removeBelt(child.id, true, fillHeadGap);
                childId = null;
            });
        } else if (belt.type === BELT_RAMP_UP) {
            const rampBelts = this.game.query("GetRampParents", {id: parentId});
            rampBelts.forEach(parent => {
                this._removeBelt(parent.id, true, fillHeadGap);
                parentId = null;
            });
        }

        let parentPathHead = null;
        if (parentId) {
            parentPathHead = this._getBeltPathHead(parentId);
            this.game.exec("InsertBeltPath", {id: parentPathHead});
            this._stashItems(parentPathHead);
            this._stashOutputItem(parentPathHead);
            this.game.exec("CalculateBeltPath", {id: parentPathHead});
            this.game.exec("InvalidatePath", {id: parentPathHead});
        }

        if (childId && childId !== parentPathHead) {
            this.game.exec("NullifyPathTail", {id: childId});
            const created = this.game.queryScalar("InsertBeltPath", {id: childId});
            this._stashItems(childId);
            this.game.exec("CalculateBeltPath", {id: childId});
            this.game.exec("MaterializeBeltPath", {id: childId});

            if (created) {
                this._populateBeltPathPorts(childId);
            }
        }

        if (parentPathHead) {
            fillHeadGap.push(parentPathHead);
            this.game.exec("MaterializeBeltPath", {id: parentPathHead});
            const parentPathHeadParts = this._getPath(parentPathHead);
            this.game.publishEventNow(new BeltPathRecalculateEvent(belt.x, belt.y, parentPathHeadParts));
        }

        if (childId && childId !== parentPathHead) {
            fillHeadGap.push(childId);
        }

        if (!recursive) {
            this._unStashItems();
            this._unStashOutputItem();

            if (new Set(fillHeadGap).size !== fillHeadGap.length) {
                throw new Error("fillHeadGap has duplicate entries");
            }

            fillHeadGap.forEach(pathId => {
                this.game.exec("FillHeadGap", {id: pathId});
            });

            this.game.end();
        }
    }

    // ---- Helpers ----

    /**
     * @private
     * Removes all DB rows for a belt and returns the IDs of its former child and parent.
     * @param {BigInt} id
     * @returns {{childId: BigInt|null, parentId: BigInt|null}}
     */
    _eraseBelt(id) {
        const childId = this.game.queryScalar("DetachChild", {id});
        this.game.exec("DeleteItems", {id});
        this.game.exec("UnassignBeltPath", {id});
        this.game.exec("DeleteUnusedPathPorts", {id});
        this.game.exec("DeletePath", {id});
        this.game.exec("ClearSolitaryBeltPortItem", {id});
        this.game.exec("NullifyPathTail", {id});
        const parentId = this.game.queryScalar("DeleteBeltRow", {id});
        return {childId, parentId};
    }

    /**
     * @private
     * @param {BigInt} id
     * @param {{x: number, y: number, direction: number, type: number}} options
     */
    _publishBeltInsert(id, options) {
        const parent = this.game.querySingle("GetBeltParent", {id});
        const parentX = parent === null ? null : parent.x;
        const parentY = parent === null ? null : parent.y;
        this.game.publishEventNow(new BeltInsertEvent(options.x, options.y, id, options.direction, options.type, parentX, parentY));
    }

    _stashItems(id) {
        this.game.exec("StashItems", {id});
        this.game.exec("DeleteItems", {id});
    }

    _stashOutputItem(id) {
        this.game.exec("StashOutputItem", {id});
        this.game.exec("RemoveOutputItem", {id});
    }

    _unStashItems() {
        this.game.exec("UnStashItems");
        this.game.exec("TruncateStashedItems");
        this.game.exec("RecalculateNextGap");
        this.game.exec("RecalculateNextItem");
    }

    _unStashOutputItem() {
        this.game.exec("UnStashOutputItem");
        this.game.exec("TruncateStashedOutputItem");
    }

    /**
     * @private
     * @param {BigInt} id
     * @returns {BigInt[]}
     */
    _getPath(id) {
        const rows = this.game.query("GetBeltPath", {id});
        return rows.map(row => row.id);
    }

    /**
     * @private
     * @param {BigInt} id
     * @returns {BigInt|null}
     */
    _getBeltPathHead(id) {
        const result = this.game.query("GetBeltPathHead", {id});

        if (result.length === 0) {
            return null;
        }

        return result[result.length - 1].id;
    }

    /**
     * @private
     * @param {BigInt} id
     * @param {BigInt|null} [inheritedOutPort] - existing out_port_id to preserve when no downstream exists
     */
    _populateBeltPathPorts(id, inheritedOutPort = null) {
        const head = this.game.querySingle("GetBelt", {id});
        const tail = this.game.querySingle("GetTail", {id});

        const outputPorts = upstreamPorts(this.game, "Belt", head);

        // When more than one adjacent output feeds this head, deterministically pick
        // the oldest (lowest id) port so path resolution is stable regardless of the
        // order upstreamPorts returns them in. Math.min can't be used here: port ids
        // are BigInt.
        const candidatePorts = Object.values(outputPorts);
        let inputPort;
        if (candidatePorts.length > 0) {
            inputPort = candidatePorts.reduce((oldest, port) => (port < oldest ? port : oldest));
        } else {
            inputPort = this.game.queryScalar("InsertPort");
        }

        const inputPorts = downstreamPorts(this.game, "Belt", tail);
        let outputPort = Object.values(inputPorts)[0];
        if (outputPort) {
            const childPath = this.game.queryScalar("GetBeltPathPortOwner", {id: outputPort});

            if (childPath) {
                this.game.exec("DeleteInPort", {id: childPath});
                const port = this.game.queryScalar("InsertPort");
                this.game.exec("UpdateInPort", {id: childPath, port});
                outputPort = port;
            }
        } else {
            outputPort = inheritedOutPort || this.game.queryScalar("InsertPort");
        }

        this.game.exec("UpdateBeltPathPorts", {id, inPort: inputPort, outPort: outputPort});
    }
}
