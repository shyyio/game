import {BeltType, ChunkSize, Direction, Directions, ItemFlag, ItemType,} from "@/backend/constants.js";
import {rotate} from "@/util.js";
import {OpCode, TickOp, TickPhase} from "@/backend/core.js";

export const Chunk = `(
    CASE WHEN x < 0 AND x % ${ChunkSize} != 0 THEN x/${ChunkSize} -1 ELSE x/${ChunkSize} END
    || ',' ||
    CASE WHEN y < 0 AND y % ${ChunkSize} != 0 THEN y/${ChunkSize} -1 ELSE y/${ChunkSize} END
)`;

const CoreSchema = `
    CREATE TABLE BeltPath (
        id INTEGER PRIMARY KEY REFERENCES Belt(id) ON DELETE CASCADE,
        tail INT UNIQUE REFERENCES Belt(id),
        length INT,

        head_gap INT
            CHECK (head_gap >= 0 AND head_gap <= length),

        in_port INT REFERENCES Port(id) ON DELETE SET NULL
            CHECK (in_port IS NULL OR in_port != out_port),

        out_port INT REFERENCES Port(id) ON DELETE SET NULL
            CHECK (out_port IS NULL OR in_port != out_port),

        next_gap_id INT,
        next_item_id INT
    );

    CREATE INDEX BeltPath_ports ON BeltPath(in_port, out_port);

    CREATE TABLE Port (
        id INTEGER PRIMARY KEY,
        item INT,
        locked INT NOT NULL DEFAULT (0) CHECK ( locked=0 OR locked=1 )
    );

    CREATE TABLE Belt
    (
        id INTEGER PRIMARY KEY,
        parent INT UNIQUE REFERENCES Belt(id),

        path INT REFERENCES BeltPath,
        path_index INT,

        x INT NOT NULL,
        y INT NOT NULL,
        type INT NOT NULL
            CHECK (type >= 0),

        chunk TEXT GENERATED ALWAYS AS (${Chunk}) VIRTUAL,

        direction INT NOT NULL
    );

    CREATE UNIQUE INDEX Belt_x_y_direction ON Belt(x, y, direction, type);
    CREATE INDEX Belt_path ON Belt(path, path_index);

    CREATE TABLE BeltPathItem (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        path INT NOT NULL REFERENCES BeltPath ON DELETE CASCADE,
        length INT NOT NULL CHECK (length >= 0),

        type INT NOT NULL CHECK (type >= 0)
    );

    CREATE INDEX BeltPathItem_path_id_type ON BeltPathItem(path, id, type);
    CREATE INDEX BeltPathItem_length ON BeltPathItem (length);
`;

const CoreTempSchema = `
    CREATE TEMPORARY TABLE Numbers (
        value INTEGER PRIMARY KEY NOT NULL
    );

    INSERT INTO Numbers
    WITH RECURSIVE series (value) AS (
        SELECT 0
        UNION ALL
        SELECT value + 1 FROM series WHERE value + 1 < ${ChunkSize**2}
    )
    SELECT value FROM series;

    CREATE TEMPORARY TABLE StashedItem (
        id INTEGER PRIMARY KEY,
        belt INT,
        type INT
    );

    CREATE TEMPORARY TABLE StashedOutputItem (
        id INTEGER PRIMARY KEY,
        belt INT,
        type INT
    );

    CREATE TEMPORARY TABLE BeltPathInputItem (
        path INT,
        port INT
    );

    CREATE TEMPORARY TABLE BeltPathOutputItem (
        path INTEGER PRIMARY KEY,
        port INT NOT NULL,
        item_id INT NOT NULL,
        item_type INT NOT NULL
    );

    CREATE TEMPORARY TABLE PortTransfer (
        port INTEGER PRIMARY KEY,
        item INT,
        tx_id INT
    );
`;

const CorePragma = `
    PRAGMA foreign_keys=1;
    PRAGMA ignore_check_constraints=0;
    PRAGMA journal_mode=off;
    PRAGMA temp_store=memory;
    PRAGMA optimize=0x10002;
`;

const CoreTriggers = `
    CREATE TEMP TRIGGER Belt_parent_update AFTER UPDATE OF parent ON main.Belt
    BEGIN
        SELECT console_log('Belt_parent_update');
        
        WITH child AS (
            VALUES (NEW.id, NEW.parent)
        )
        SELECT on_belt_update(CAST(child.id AS TEXT), parent.x, parent.y)
            FROM child 
            LEFT JOIN Belt parent ON child.parent = parent.id;
    END;
    
    CREATE TEMP TRIGGER Belt_insert AFTER INSERT ON main.Belt
    BEGIN
        SELECT console_log('Belt_insert');
        
        WITH child AS (
            VALUES (NEW.id, NEW.x, NEW.y, NEW.direction, NEW.type, NEW.parent)
        )
        SELECT on_belt_insert(CAST(child.id AS TEXT), child.x, child.y, child.direction, child.type, parent.x, parent.y)
            FROM child 
            LEFT JOIN Belt parent ON child.parent = parent.id;
    END;
    
    CREATE TEMP TRIGGER Belt_delete BEFORE DELETE ON main.Belt
    BEGIN
        SELECT console_log('Belt_delete');
        
        -- If tail is deleted, invalidate path and remove output_item
        UPDATE Port SET item=NULL WHERE id=(SELECT out_port FROM BeltPath WHERE id=OLD.path AND tail=OLD.id);
        UPDATE BeltPath SET tail=NULL WHERE id=OLD.path AND tail=OLD.id;
        
        -- If head is deleted, invalidate the path
        UPDATE Belt SET path=NULL, path_index=NULL WHERE OLD.id=OLD.path AND Belt.path=OLD.path;
        
        SELECT on_belt_delete(CAST(OLD.id AS TEXT));
    END;
    
    CREATE TEMP TRIGGER BeltPath_delete AFTER DELETE ON main.BeltPath
    BEGIN
        SELECT console_log('BeltPath_delete');
        
        SELECT on_belt_path_delete(CAST(OLD.id AS TEXT));
    END;
    
    CREATE TEMP TRIGGER BeltPathItem_insert AFTER INSERT ON main.BeltPathItem
    BEGIN
        SELECT console_log('BeltPathItem_insert');
        
        UPDATE BeltPath SET
            next_gap_id = NEW.id
        WHERE
            NEW.type = ${ItemType.GAP}
            AND id=NEW.path
            AND next_gap_id IS NULL;
            
        UPDATE BeltPath SET
            next_item_id = NEW.id
        WHERE
            NEW.type != ${ItemType.GAP}
            AND id=NEW.path
            AND next_item_id IS NULL;
           
        SELECT on_belt_path_item_insert(CAST(NEW.path AS TEXT), CAST(NEW.id AS TEXT), NEW.type, NEW.length,
            CASE WHEN EXISTS (SELECT id FROM StashedItem) THEN ${ItemFlag.STASHED} ELSE 0 END
        );
    END;
    
    CREATE TEMP TRIGGER BeltPathItem_delete AFTER DELETE ON main.BeltPathItem
    BEGIN
        SELECT console_log('BeltPathItem_delete');
    
        UPDATE BeltPath SET
            next_gap_id = (SELECT MIN(id) FROM BeltPathItem WHERE path=OLD.path AND type=${ItemType.GAP}) 
        WHERE
            OLD.type = ${ItemType.GAP}
            AND id = OLD.path AND next_gap_id = OLD.id;
            
        UPDATE BeltPath SET
            next_item_id = (SELECT MIN(id) FROM BeltPathItem WHERE path=OLD.path AND type!=${ItemType.GAP}) 
        WHERE
            OLD.type != ${ItemType.GAP}
            AND id = OLD.path AND next_item_id = OLD.id;
            
        SELECT on_belt_path_item_delete(CAST(OLD.id AS TEXT));
    END;
    
    CREATE TEMP TRIGGER BeltPathItem_update AFTER UPDATE OF length ON main.BeltPathItem
    BEGIN
        SELECT console_log('BeltPathItem_update');
        
        SELECT on_belt_path_item_update(CAST(NEW.id AS TEXT), NEW.length) 
        WHERE NEW.length > 0; -- if length=0, it will be deleted anyway
    END;
`;

const UP = Direction.UP;
const RIGHT = Direction.RIGHT;
const DOWN = Direction.DOWN;
const LEFT = Direction.LEFT;

// type is parent and @type is child
const CompatibleStraightBeltConnection = `(
       (type=${BeltType.NORMAL}       AND @type=${BeltType.NORMAL}) 
    OR (type=${BeltType.NORMAL}       AND @type=${BeltType.RAMP_DOWN}) 
    OR (type=${BeltType.RAMP_DOWN}    AND @type=${BeltType.UNDERGROUND}) 
    OR (type=${BeltType.RAMP_DOWN}    AND @type=${BeltType.RAMP_UP})
    OR (type=${BeltType.UNDERGROUND}  AND @type=${BeltType.UNDERGROUND}) 
    OR (type=${BeltType.UNDERGROUND}  AND @type=${BeltType.RAMP_UP}) 
    OR (type=${BeltType.RAMP_UP}      AND @type=${BeltType.NORMAL}))`;

const CompatibleBentBeltConnection = `(
   (type=${BeltType.NORMAL} AND @type=${BeltType.NORMAL})
OR (type=${BeltType.RAMP_UP} AND @type=${BeltType.NORMAL}))`;

// noinspection SqlWithoutWhere
/**
 * @enum
 */
const CoreStatements = {
    StashOutputItem: `
        INSERT INTO StashedOutputItem (belt, type)
        SELECT tail, p.item
        FROM BeltPath
            INNER JOIN Port p ON p.id = BeltPath.out_port
        WHERE BeltPath.id = CAST(@id AS INT)
            AND p.item IS NOT NULL;
    `,
    RemoveOutputItem: `
        UPDATE Port
        SET item=NULL
        FROM BeltPath
        WHERE BeltPath.id = CAST(@id AS INT)
          AND Port.id = BeltPath.out_port;
    `,
    UnStashOutputItem: `
        UPDATE Port
        SET item = StashedOutputItem.type
        FROM StashedOutputItem
             INNER JOIN Belt ON Belt.id = StashedOutputItem.belt
             INNER JOIN BeltPath ON BeltPath.id = Belt.path
        WHERE Port.id = BeltPath.out_port;
    `,
    TruncateStashedOutputItem: `DELETE FROM StashedOutputItem;`,

    StashGap: `
        INSERT INTO StashedItem (belt, type) VALUES 
            -- Adding one belt gives +2 length
            (CAST(@id AS INT), ${ItemType.GAP}),
            (CAST(@id AS INT), ${ItemType.GAP});
    `,

    StashItems: `
        INSERT INTO StashedItem (belt, type)
        WITH items AS (
            SELECT 
                path, 
                type, 
                length, 
                coalesce(SUM(length) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW EXCLUDE CURRENT ROW), 0) AS path_index
           FROM BeltPathItem
           WHERE path = CAST(@id AS INT)
           UNION ALL
           -- "instantiate" the head_gap as gap items
           SELECT 
                BeltPath.id AS path,
                ${ItemType.GAP} AS type,
                head_gap AS length,
                length - head_gap AS path_index
           FROM BeltPath
           WHERE BeltPath.id = CAST(@id AS INT)
        ),
        items_exploded AS (
            SELECT path, type, path_index + value AS path_index
            FROM items
                CROSS JOIN Numbers
            WHERE value < items.length
        )
        SELECT Belt.id, items_exploded.type
        FROM items_exploded
            INNER JOIN Belt ON 
                Belt.path_index = CAST(items_exploded.path_index / 2 AS INT)
                AND Belt.path = items_exploded.path
        ORDER BY items_exploded.path_index;
    `,

    DeleteItems: `DELETE
                  FROM BeltPathItem
                  WHERE path = CAST(@id AS INT);`,

    UnStashItems: `
        INSERT INTO BeltPathItem (path, length, type)
        WITH raw_items AS (
            SELECT Belt.id, Belt.path, item.type
            FROM StashedItem item
                INNER JOIN Belt on Belt.id = item.belt
            ORDER BY Belt.path_index
        ),
        items AS (
            SELECT path,
                   type,
                   row_number() over () global_index 
            FROM raw_items
        ),
        ranked_items AS (
            SELECT path,
                   type,
                   global_index,
                   row_number() over (PARTITION BY type ORDER BY global_index) group_index
            FROM items
        ),
        grouped_items AS (
            SELECT path,
                   COUNT(*) as length,
                   type,
                   SUM(type) OVER (PARTITION BY path) type_sum
            FROM ranked_items
            -- Only group gaps
            GROUP BY path, CASE WHEN type != ${ItemType.GAP} THEN -global_index ELSE (global_index - group_index) END
            ORDER BY global_index
        )
        SELECT path, length, type
        FROM grouped_items
        -- Don't bother un-stashing if it's only gaps
        WHERE type_sum > 0;
    `,

    TruncateStashedItems: `DELETE FROM StashedItem;`,

    FillHeadGap: `
        UPDATE BeltPath
        SET head_gap = length - COALESCE((SELECT SUM(length) FROM BeltPathItem WHERE path = CAST(@id AS INT)), 0)
        WHERE id = CAST(@id AS INT);
    `,

    GetBeltChild: `
        SELECT Belt.id,
               Belt.path,
               Belt.parent          oldParent,
               Belt.chunk,
               current_parent.chunk oldParentChunk
        FROM Belt
                 LEFT JOIN Belt current_parent ON Belt.parent = current_parent.id
                 LEFT JOIN Belt new_parent ON new_parent.x = @x AND new_parent.y = @y
                 LEFT JOIN Belt new_grandparent ON new_grandparent.id = new_parent.parent
        WHERE Belt.x = CASE
                           WHEN @direction = ${UP} THEN
                               @x
                           WHEN @direction = ${RIGHT} THEN
                               @x + 1
                           WHEN @direction = ${DOWN} THEN
                               @x
                           WHEN @direction = ${LEFT} THEN
                               @x - 1
            END
          AND Belt.y = CASE
                           WHEN @direction = ${UP} THEN
                               @y - 1
                           WHEN @direction = ${RIGHT} THEN
                               @y
                           WHEN @direction = ${DOWN} THEN
                               @y + 1
                           WHEN @direction = ${LEFT} THEN
                               @y
            END
          AND Belt.direction != CASE
                                    WHEN @direction = ${UP} THEN
                                        ${DOWN}
                                    WHEN @direction = ${RIGHT} THEN
                                        ${LEFT}
                                    WHEN @direction = ${DOWN} THEN
                                        ${UP}
                                    WHEN @direction = ${LEFT} THEN
                                        ${RIGHT}
            END
          AND (new_grandparent.path IS NULL OR new_grandparent.path != Belt.id) -- Don't connect loops
          AND (
            (Belt.type = ${BeltType.NORMAL} AND @type = ${BeltType.NORMAL})
                OR
            (
                -- Ramp up -> Normal
                (Belt.type = ${BeltType.NORMAL} AND @type = ${BeltType.RAMP_UP})
                )
                OR
            (
                Belt.direction = @direction AND (
                    --Normal -> Ramp
                    (Belt.type = ${BeltType.RAMP_DOWN} AND @type = ${BeltType.NORMAL})
                        OR (Belt.type = ${BeltType.NORMAL} AND @type = ${BeltType.RAMP_UP})
                        -- Ramp -> Ramp
                        OR (Belt.type = ${BeltType.RAMP_UP} AND @type = ${BeltType.RAMP_DOWN})
                        -- Ramp -> underground
                        OR (Belt.type = ${BeltType.UNDERGROUND} AND @type = ${BeltType.RAMP_DOWN})
                        OR (Belt.type = ${BeltType.RAMP_UP} AND @type = ${BeltType.UNDERGROUND})
                    )
                )
            )
    `,

    UpdateBeltChild: `
        UPDATE Belt
        SET parent=
                CASE
                    WHEN direction = ${UP} THEN
                        (SELECT MAX(id)
                         FROM Belt b
                         WHERE (b.x = Belt.x AND b.y = Belt.y + 1 AND b.direction = ${UP})
                            OR (b.x = Belt.x - 1 AND b.y = Belt.y AND b.direction = ${RIGHT})
                            OR (b.x = Belt.x + 1 AND b.y = Belt.y AND b.direction = ${LEFT}))
                    WHEN direction = ${RIGHT} THEN
                        (SELECT MAX(id)
                         FROM Belt b
                         WHERE (b.x = Belt.x - 1 AND b.y = Belt.y AND b.direction = ${RIGHT})
                            OR (b.x = Belt.x AND b.y = Belt.y + 1 AND b.direction = ${UP})
                            OR (b.x = Belt.x AND b.y = Belt.y - 1 AND b.direction = ${DOWN}))
                    WHEN direction = ${DOWN} THEN
                        (SELECT MAX(id)
                         FROM Belt b
                         WHERE (b.x = Belt.x AND b.y = Belt.y - 1 AND b.direction = ${DOWN})
                            OR (b.x = Belt.x - 1 AND b.y = Belt.y AND b.direction = ${RIGHT})
                            OR (b.x = Belt.x + 1 AND b.y = Belt.y AND b.direction = ${LEFT}))
                    WHEN direction = ${LEFT} THEN
                        (SELECT MAX(id)
                         FROM Belt b
                         WHERE (b.x = Belt.x + 1 AND b.y = Belt.y AND b.direction = ${LEFT})
                            OR (b.x = Belt.x AND b.y = Belt.y + 1 AND b.direction = ${UP})
                            OR (b.x = Belt.x AND b.y = Belt.y - 1 AND b.direction = ${DOWN}))
                    END
        WHERE id = CAST(@id AS INT);
    `,

    GetBelt: `SELECT x, y, type, direction, parent, chunk
              FROM Belt
              WHERE id = CAST(@id AS INT);`,

    GetTail: `
        SELECT x, y, type, direction, parent, chunk
        FROM Belt
        WHERE id = (SELECT tail FROM BeltPath WHERE id = CAST(@id AS INT));
    `,

    GetBeltParent: `
        SELECT parent.id, parent.chunk, parent.path
        FROM Belt
                 INNER JOIN Belt parent on parent.id = Belt.parent
        WHERE Belt.id = CAST(@id AS INT);
        ;`,

    InsertBelt: `
        INSERT INTO Belt (parent, x, y, type, direction)
        VALUES (CASE
                    WHEN @direction = ${UP} THEN
                        (SELECT MAX(id)
                         FROM Belt
                         WHERE (x = @x AND y = @y + 1 AND direction = ${UP} AND ${CompatibleStraightBeltConnection})
                            OR (x = @x - 1 AND y = @y AND direction = ${RIGHT} AND ${CompatibleBentBeltConnection})
                            OR (x = @x + 1 AND y = @y AND direction = ${LEFT} AND ${CompatibleBentBeltConnection}))
                    WHEN @direction = ${RIGHT} THEN
                        (SELECT MAX(id)
                         FROM Belt
                         WHERE (x = @x - 1 AND y = @y AND direction = ${RIGHT} AND ${CompatibleStraightBeltConnection})
                            OR (x = @x AND y = @y + 1 AND direction = ${UP} AND ${CompatibleBentBeltConnection})
                            OR (x = @x AND y = @y - 1 AND direction = ${DOWN} AND ${CompatibleBentBeltConnection}))
                    WHEN @direction = ${DOWN} THEN
                        (SELECT MAX(id)
                         FROM Belt
                         WHERE (x = @x AND y = @y - 1 AND direction = ${DOWN} AND ${CompatibleStraightBeltConnection})
                            OR (x = @x - 1 AND y = @y AND direction = ${RIGHT} AND ${CompatibleBentBeltConnection})
                            OR (x = @x + 1 AND y = @y AND direction = ${LEFT} AND ${CompatibleBentBeltConnection}))
                    WHEN @direction = ${LEFT} THEN
                        (SELECT MAX(id)
                         FROM Belt
                         WHERE (x = @x + 1 AND y = @y AND direction = ${LEFT} AND ${CompatibleStraightBeltConnection})
                            OR (x = @x AND y = @y + 1 AND direction = ${UP} AND ${CompatibleBentBeltConnection})
                            OR (x = @x AND y = @y - 1 AND direction = ${DOWN} AND ${CompatibleBentBeltConnection}))
                    END,
                @x, @y, @type, @direction)
        RETURNING Belt.id;
    `,

    GetBeltPathHead: `
        WITH RECURSIVE path AS (SELECT id, parent, chunk
                                FROM Belt
                                WHERE id = CAST(@id AS INT)
                                UNION
                                SELECT parent.id, parent.parent, parent.chunk
                                FROM Belt parent
                                         INNER JOIN path ON path.parent = parent.id AND path.chunk = parent.chunk)
        SELECT id
        FROM path;
    `,

    GetExistingBeltPathHead: `
        SELECT path
        FROM Belt
        WHERE id = CAST(@id AS INT)
    `,

    CalculateBeltPath: `
        WITH parent_belt AS (SELECT id, chunk
                             FROM Belt
                             WHERE id = @id),
             path AS (SELECT id, chunk
                      FROM parent_belt
                      UNION
                      SELECT child.id, child.chunk
                      FROM Belt child
                               INNER JOIN path ON path.id = child.parent
                      WHERE path.chunk = child.chunk),
             indexed_path AS (SELECT id, row_number() over () idx
                              FROM path),
             reverse_path AS (SELECT id, ROW_NUMBER() OVER (ORDER BY idx DESC) - 1 seq
                              FROM indexed_path)
        UPDATE Belt
        SET path=CAST(@id AS INT),
            path_index=(SELECT seq
                        FROM reverse_path
                        WHERE reverse_path.id = Belt.id)
        WHERE id IN (SELECT id FROM reverse_path);
    `,

    MaterializeBeltPath: `
        WITH new_tail AS (SELECT id FROM Belt WHERE path = CAST(@id AS INT) ORDER BY path_index LIMIT 1),
             path_length AS (SELECT COUNT(*) * 2 - 1 as length
                             FROM Belt
                             WHERE path = CAST(@id AS INT))
        UPDATE BeltPath
        SET tail     = (SELECT id FROM new_tail),
            length   = path_length.length,
            head_gap = path_length.length
        -- If the tail changed, remove output_item
        --output_item = CASE WHEN (SELECT id FROM new_tail) != tail THEN NULL ELSE output_item END
        FROM path_length
        WHERE id = CAST(@id AS INT)
        RETURNING length;
    `,

    DeleteInPort: `
        DELETE
        FROM Port
        WHERE id = (SELECT in_port FROM BeltPath WHERE id = CAST(@id AS INT))
          AND NOT EXISTS (SELECT 1 FROM BeltPath WHERE out_port = Port.id);
    `,

    UpdateInPort: `UPDATE BeltPath
                   SET in_port=CAST(@port AS INT)
                   WHERE id = CAST(@id AS INT)`,

    DeleteOutPort: `
        DELETE
        FROM Port
        WHERE id = (SELECT out_port FROM BeltPath WHERE id = CAST(@id AS INT))
    `,

    InheritOutPort: `
        UPDATE BeltPath
        SET out_port=(SELECT out_port
                      FROM BeltPath
                      WHERE id = CAST(@child AS INT))
        WHERE id = CAST(@parent AS INT)
          AND EXISTS (SELECT 1 FROM BeltPath WHERE id = CAST(@child AS INT) AND out_port IS NOT NULL)
    `,

    /**
     *  Case 1: Output is full, or next item is a gap
     */
    TickBeltPathCase1: `
        UPDATE BeltPathItem
        SET length = length - 1
        WHERE id IN (
            SELECT p.next_gap_id
            FROM BeltPath p
            INNER JOIN Port outPort ON outPort.id = p.out_port
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
        );
    `,

    /**
     * Case 2: output is not full and next item is not a gap
     *  - pop item into output port
     */
    TickBeltPathCase2: `
        INSERT INTO BeltPathOutputItem (path, item_id, item_type, port)
        SELECT BeltPath.id, item.id, item.type, outPort.id
        FROM BeltPath
            INNER JOIN BeltPathItem item ON item.id = next_item_id
            INNER JOIN Port outPort ON outPort.id = out_port
        WHERE
            -- Next item is an item
            (
                next_gap_id IS NULL
                OR
                next_item_id < next_gap_id
            )
            -- There is space in the output
            AND outPort.item IS NULL;
    `,

    TickBeltPathRecalculateHeadGap: `
        UPDATE BeltPath
        SET head_gap = head_gap + 1
        WHERE (next_gap_id IS NOT NULL
            OR id IN (SELECT path FROM BeltPathOutputItem)
        );
        -- If there is a gap anywhere in the path (including a 0-length gap),
        --  or if an item was consumed (output_item_id !=NULL)
        --  this means that the head_gap needs to be incremented (UNLESS an item was inserted this tick)
    `,

    TickBeltFillOutPort: `
        UPDATE Port
        SET item=item.item_type, locked=1
        FROM BeltPathOutputItem item
        WHERE Port.id = item.port;
    `,

    TickBeltPathInsertItem: `
        INSERT INTO BeltPathItem (path, type, length)
        -- If the head gap is more than 1 spaces, add a gap item first
        SELECT BeltPath.id,
               0,
               head_gap - 1
        FROM BeltPath
            INNER JOIN Port inPort ON inPort.id = in_port
        WHERE head_gap > 1
          AND inPort.item IS NOT NULL AND inPort.locked=0
        UNION ALL
        -- item
        SELECT BeltPath.id,
               inPort.item,
               1
        FROM BeltPath
            INNER JOIN Port inPort ON inPort.id = in_port
        WHERE head_gap > 0
          AND inPort.item IS NOT NULL AND inPort.locked=0;
    `,

    TickBeltPathCleanup1: `
        DELETE
        FROM BeltPathItem
        WHERE length = 0 OR id IN (SELECT item_id FROM BeltPathOutputItem);
    `,

    TickBeltPathCleanup2: `DELETE FROM BeltPathOutputItem;`,

    TickBeltPathCleanup3: `
        INSERT INTO BeltPathInputItem (path, port)
        SELECT BeltPath.id, Port.id
        FROM BeltPath
            INNER JOIN Port ON Port.id = in_port
        WHERE BeltPath.head_gap > 0
          AND item IS NOT NULL
          AND locked=0
    `,

    TickBeltPathCleanup4: `
        UPDATE Port
        SET item = NULL
        FROM BeltPathInputItem
        WHERE Port.id = BeltPathInputItem.port;
    `,

    TickBeltPathCleanup5: `
        UPDATE BeltPath
        SET head_gap = 0
        FROM BeltPathInputItem
        WHERE BeltPath.id = BeltPathInputItem.path;
    `,
    TickBeltPathCleanup6: `DELETE FROM BeltPathInputItem;`,

    UnlockPorts: `UPDATE Port SET locked=0 WHERE locked=1;`,

    GetBeltPath: `SELECT id FROM Belt WHERE path = CAST(@id AS INT) ORDER BY path_index;`,

    RemoveBeltPath: `UPDATE Belt SET path=NULL WHERE id = CAST(@id AS INT);`,

    GetRampParents: `
        WITH RECURSIVE path AS (
            SELECT id, parent, type FROM Belt WHERE id = CAST(@id AS INT)
            UNION
            SELECT parent.id, parent.parent, parent.type 
            FROM Belt parent
            INNER JOIN path ON path.parent = parent.id AND parent.type = ${BeltType.UNDERGROUND}
        )
        SELECT id
        FROM path
        WHERE type = ${BeltType.UNDERGROUND};
    `,

    GetRampChildren: `
        WITH RECURSIVE path AS (
            SELECT id, type FROM Belt WHERE id = CAST(@id AS INT)
            UNION
            SELECT child.id, child.type
            FROM Belt child
            INNER JOIN path ON child.parent = path.id AND child.type = ${BeltType.UNDERGROUND}
        )
        SELECT id
        FROM path
        WHERE type = ${BeltType.UNDERGROUND};
    `,

    InsertBeltPath: `
        INSERT INTO BeltPath (id) VALUES (CAST(@id AS INT))
        ON CONFLICT DO NOTHING
        RETURNING 1 as created;
    `,

    InsertPort: `INSERT INTO Port DEFAULT VALUES RETURNING id;`,

    UpdateBeltPathPorts: `
        UPDATE BeltPath
        SET in_port=CAST(@inPort AS INT),
            out_port=CAST(@outPort AS INT)
        WHERE id = CAST(@id AS INT);
    `,

    GetBeltPathPortOwner: `SELECT id FROM BeltPath WHERE in_port = CAST(@id AS INT);`,

    DetachBelt: `UPDATE Belt
                 SET parent=NULL
                 WHERE parent = CAST(@id AS INT)
                 RETURNING id;`,

    DeletePath: `DELETE
                 FROM BeltPath
                 WHERE id = CAST(@id AS INT)`,

    InvalidatePath: `UPDATE BeltPath
                     SET tail=NULL,
                         length=NULL
                     WHERE id = CAST(@id AS INT)`,

    DeleteBelt: `DELETE
                 FROM Belt
                 WHERE id = CAST(@id AS INT)
                 RETURNING parent;`,

    End: "END TRANSACTION",
    Begin: "BEGIN TRANSACTION;",
    Rollback: "ROLLBACK TRANSACTION;",

    CleanPortTransfer: "UPDATE Port SET item=NULL WHERE id IN (SELECT port FROM PortTransfer);",
    SetPort: `
        UPDATE Port 
        SET item=pt.item, locked=1
        FROM PortTransfer pt WHERE Port.id = port;
    `,
    TruncatePortTransfer: "DELETE FROM PortTransfer;",
}

export class DbSchema {


    /**
     @param ruleSet {RuleSet}
     */
    constructor(ruleSet) {
        this.preparedStatements = {};

        this.tickPhases = {
            [TickPhase.INIT]: [
                "UnlockPorts"
            ]
        }
        this.triggers = [CoreTriggers];
        this.initSchema = [CoreSchema, ...ruleSet.initSchema];
        this.tempSchema = [CoreTempSchema, ...ruleSet.tempSchema];
        this.pragma = [CorePragma];

        this._createDeleteTriggers(ruleSet.definitions)
        this._createFanoutTriggers(ruleSet.definitions);

        [TickPhase.INIT, TickPhase.INPUT, TickPhase.OUTPUT].forEach(phase => {
            this._prepareTick(ruleSet.definitions, phase);
        });

        this._prepareInsert(ruleSet.definitions);
        this._prepareIsOccupied(ruleSet.definitions);
        this._preparePortQueries(ruleSet.definitions);

        Object.assign(this.preparedStatements, CoreStatements);
    }

    /**
     * @param definitions {Object<string, ObjectDefinition>}
     */
    _createDeleteTriggers(definitions) {
        const allPorts = this._getAllPorts(definitions);

        delete allPorts["Belt"]
        allPorts["BeltPath"] = ["in_port", "out_port"]

        Object.entries(allPorts).forEach(([name, ports]) => {

            const selfPorts = ports
                .map(port => `SELECT ${port} FROM ${name} WHERE id = OLD.id`)
                .join(" UNION ALL ");

            const otherPorts = Object.entries(allPorts).map(([otherName, otherPort]) => {
                const where = otherPort.map(p => `${p}=Port.id`).join(" OR ");
                if (otherName === name) {
                    return `SELECT 1 FROM ${otherName} WHERE id != OLD.id AND (${where})`;
                } else {
                    return `SELECT 1 FROM ${otherName} WHERE ${where}`;
                }
            }).join(" UNION ALL ")

            const deleteStmt = `DELETE FROM Port WHERE id IN (${selfPorts}) AND NOT EXISTS(${otherPorts});`

            if (name === "BeltPath") {
                this._prepare(
                    "DeleteUnusedPathPorts",
                    deleteStmt.replaceAll("OLD.id", "CAST(@id AS INT)")
                );

                this._prepare(
                    "DeleteUnusedPathOutputPort",
                    `DELETE FROM Port WHERE 
                        id IN (SELECT in_port FROM BeltPath WHERE id=OLD.id)
                        AND NOT EXISTS(${otherPorts});
                     `.replaceAll("OLD.id", "CAST(@id AS INT)")
                );
            }

            this.triggers.push(`
                CREATE TEMP TRIGGER ${name}_delete_ports BEFORE DELETE ON main.${name}
                BEGIN
                    SELECT console_log('${name}_delete_ports');
                    ${deleteStmt}
                END;`
            );
        });
    }

    _createFanoutTriggers(definitions) {
        Object.entries(definitions).forEach(([name, _]) => {

            if (name === "Belt") {
                return;
            }

            this.triggers.push(
                `CREATE TEMP TRIGGER ${name}_insert AFTER INSERT ON main.${name}
                BEGIN
                    SELECT on_object_insert('${name}', CAST(NEW.id AS TEXT), NEW.x, NEW.y, NEW.direction);
                END;`
            );

            this.triggers.push(
                `CREATE TEMP TRIGGER ${name}_delete AFTER DELETE ON main.${name}
                BEGIN
                    SELECT on_object_delete('${name}', CAST(OLD.id AS TEXT));
                END;`
            );
        });
    }

    _getAllPorts(definitions) {
        return Object.fromEntries(
          Object.entries(definitions).map(([name, def]) => [
            name,
            [
                ...(def.inputPorts ?? []),
                ...(def.outputPorts ?? [])
            ].map(port => port.name),
          ])
        );
    }

    _prepare(name, statement) {
        this.preparedStatements[name] = statement;
    }

    /**
     * @param definitions {Object<string, ObjectDefinition>}
     */
    _prepareInsert(definitions) {

        Object.entries(definitions).forEach(([name, def]) => {
            const ports = [
                ...def.inputPorts.map(p => p.name),
                ...def.outputPorts.map(p => p.name)
            ];
            const portNames = ports.join(",");
            const args = ports.map(p=> "@" + p).join(",");

            this._prepare(`Insert${name}`,
                `INSERT INTO ${name} (x, y, direction, ${portNames}) ` +
                    `VALUES (@x, @y, @direction, ${args})`
            );
        });
    }

    _prepareIsOccupied(definitions) {
        this._prepare("IsOccupied", Object.entries(definitions).map(([table, data]) => {
            const size = data.size;

            if (size.x === 0 && size.y === 0) {
                return `SELECT 1 FROM ${table} WHERE (x = @x AND y = @y)`;
            }

            return `SELECT 1
                    FROM ${table}
                    WHERE ` + Directions.map(dir => {
                const x = rotate(size, dir).x;
                const y = rotate(size, dir).y;

                return `(direction=${dir}` +
                    ` AND ` + (x === 0 ? `x = @x` : `x BETWEEN @x AND @x - ${x}`) +
                    ` AND ` + (y === 0 ? `y = @y)` : `y BETWEEN @y AND @y - ${y})`)
            }).join(" OR ");
        }).join("\nUNION ALL\n"));
    }

    /**
     * @param definitions {Object<string, ObjectDefinition>}
     * @param phase {TickPhase}
     */
    _prepareTick(definitions, phase) {

        this.tickPhases[phase] ||= [];
        const phaseOps = this.tickPhases[phase];

        Object.entries(definitions).forEach(([name, data]) => {

            let i = 0;
            if (data.tickPhases[phase] === undefined) {
                return;
            }
            data.tickPhases[phase].forEach(op => {

                if (op.op === OpCode.INPUT_TRANSFER) {
                    const def = data.inputTransfers[op.key];
                    const {slot, port, join, where, afterTransfer} = def;

                    this._prepare(`${name}_inTx_${i}_prepare`, prepareInputTransfer(name, slot, port, join, where));
                    phaseOps.push(`${name}_inTx_${i}_prepare`);

                    this._prepare(`${name}_inTx_${i}_setSlot`, setSlot(name, slot));
                    phaseOps.push(`${name}_inTx_${i}_setSlot`);

                    phaseOps.push("CleanPortTransfer");

                    if (afterTransfer) {
                        this._prepare(`${name}_inTx_${i}_afterTransfer`, afterTransfer);
                        phaseOps.push(`${name}_inTx_${i}_afterTransfer`);
                    }

                    phaseOps.push("TruncatePortTransfer");

                } else if (op.op === OpCode.OUTPUT_TRANSFER) {
                    const def = data.outputTransfers[op.key];
                    const {slot, port, join, where, afterTransfer} = def;

                    this._prepare(`${name}_outTx_${i}_prepare`, prepareOutputTransfer(name, slot, port, join, where));
                    phaseOps.push(`${name}_outTx_${i}_prepare`);

                    this._prepare(`${name}_outTx_${i}_cleanSlot`, cleanSlot(name, slot));
                    phaseOps.push(`${name}_outTx_${i}_cleanSlot`);

                    phaseOps.push("SetPort");

                    if (afterTransfer) {
                        this._prepare(`${name}_outTx_${i}_afterTransfer`, afterTransfer);
                        phaseOps.push(`${name}_outTx_${i}_afterTransfer`);
                    }

                    phaseOps.push("TruncatePortTransfer");

                } else if (op.op === OpCode.PORT_TRANSFER) {

                    const def = data.portTransfers[op.key];
                    const {inputPort, outputPort, where, join, afterTransfer} = def;

                    this._prepare(`${name}_pTx_${i}_prepare`, preparePortTransfer(name, inputPort, outputPort, join, where));
                    phaseOps.push(`${name}_pTx_${i}_prepare`);

                    phaseOps.push("SetPort");

                    if (afterTransfer) {
                        this._prepare(`${name}_pTx_${i}_afterTransfer`, afterTransfer);
                        phaseOps.push(`${name}_pTx_${i}_afterTransfer`);
                    }

                    phaseOps.push("TruncatePortTransfer");
                } else if (op.op === OpCode.STMT) {
                    this._prepare(op.key, data.statements[op.key]);
                    phaseOps.push(op.key);
                } else  {
                    throw new Error("Not Implemented");
                }

                i += 1;
            });
        });
    }

    /**
     * @param definitions {Object<string, ObjectDefinition>}
     */
    _preparePortQueries(definitions) {

        let inputPorts = {};
        let outputPorts = {};

        Object.entries(definitions).forEach(([name, def]) => {
            inputPorts[name] = def.inputPorts;
            outputPorts[name] = def.outputPorts;
        });

        this._prepare("GetInPortUp", `${beltInputs(Direction.UP)} UNION ALL ${otherPorts(inputPorts, Direction.UP)}`);
        this._prepare("GetInPortRight", `${beltInputs(Direction.RIGHT)} UNION ALL ${otherPorts(inputPorts, Direction.RIGHT)}`);
        this._prepare("GetInPortDown", `${beltInputs(Direction.DOWN)} UNION ALL ${otherPorts(inputPorts, Direction.DOWN)}`);
        this._prepare("GetInPortLeft", `${beltInputs(Direction.LEFT)} UNION ALL ${otherPorts(inputPorts, Direction.LEFT)}`);

        this._prepare("GetOutPortUp", `${beltOutputs(Direction.UP)} UNION ALL ${otherPorts(outputPorts, Direction.UP)}`);
        this._prepare("GetOutPortRight", `${beltOutputs(Direction.RIGHT)} UNION ALL ${otherPorts(outputPorts, Direction.RIGHT)}`);
        this._prepare("GetOutPortDown", `${beltOutputs(Direction.DOWN)} UNION ALL ${otherPorts(outputPorts, Direction.DOWN)}`);
        this._prepare("GetOutPortLeft", `${beltOutputs(Direction.LEFT)} UNION ALL ${otherPorts(outputPorts, Direction.LEFT)}`);
    }
}

function prepareInputTransfer(gameObject, slot, port, join, where) {
    return `INSERT INTO PortTransfer (port, item, tx_id)
            SELECT Port.id, ${gameObject}.id, Port.item
            FROM ${gameObject}
                INNER JOIN Port on Port.id = ${port} ${join || ""}
            WHERE Port.item IS NOT NULL
                AND Port.locked = 0
                AND ${slot} IS NULL 
                ${where || ""};`
}

function preparePortTransfer(gameObject, inputPort, outputPort, join, where) {
    return `
        WITH ports AS (
            SELECT
                inPort.id input, outPort.id output, inPort.item
            FROM ${gameObject}
                INNER JOIN Port inPort ON inPort.id=${inputPort} AND inPort.item IS NOT NULL AND inPort.locked = 0
                INNER JOIN Port outPort ON outPort.id=${outputPort} AND outPort.item IS NULL 
                ${join || ""}
            WHERE ${where}
        )
        INSERT INTO PortTransfer (port, item)
        SELECT input, NULL FROM ports
        UNION ALL
        SELECT output, item FROM ports`;
}

function setSlot(gameObject, slot) {
    return `UPDATE ${gameObject}
            SET ${slot}=item
            FROM PortTransfer pt
            WHERE ${gameObject}.id = tx_id;`
}

function prepareOutputTransfer(gameObject, slot, port, join, where) {
    return `INSERT INTO PortTransfer (port, tx_id, item)
            SELECT Port.id, ${gameObject}.id, ${slot}
            FROM ${gameObject}
                 INNER JOIN Port on Port.id = ${port} ${join || ""}
            WHERE Port.item IS NULL
              AND ${slot} IS NOT NULL ${where || ""};`
}

function cleanSlot(gameObject, slot) {
    return `UPDATE ${gameObject}
            SET ${slot}=NULL
            FROM PortTransfer pt
            WHERE ${gameObject}.id = tx_id;`
}

function beltInputs(direction) {
    const directions = Directions.filter(
        d => d !== Direction.rotate(direction, 2)
    );

    return (
        `SELECT Port.id
         FROM Belt INDEXED BY Belt_x_y_direction
                  INNER JOIN BeltPath on Belt.id = BeltPath.id
                  INNER JOIN Port on Port.id = BeltPath.in_port
         WHERE direction IN (${directions.join(',')})
           AND x = @x
           AND y = @y`
    );
}

function beltOutputs(direction) {
    return (
        `SELECT Port.id
         FROM Belt INDEXED BY Belt_x_y_direction
                  INNER JOIN BeltPath on Belt.id = BeltPath.tail
                  INNER JOIN Port on Port.id = BeltPath.out_port
         WHERE direction = ${direction}
           AND x = @x - ${Direction.dx(direction)}
           AND y = @y - ${Direction.dy(direction)}`
    );
}

function otherPorts(portMapping, direction) {
    return Object.entries(portMapping)
        .filter(([name, _]) => name !== "Belt")
        .map(([name, ports]) => {
            return ports.map((port) => {
                return (
                    `SELECT Port.id
                     FROM ${name}` +
                    ` INNER JOIN Port on Port.id = ${name}.${port.name}` +
                    ` WHERE direction=${direction}` +
                    ` AND x=@x - ${rotate(port, direction).x}` +
                    ` AND y=@y - ${rotate(port, direction).y}`
                );
            }).join("\nUNION ALL\n");
        }).join("\nUNION ALL\n");
}
