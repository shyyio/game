import {BeltType, ChunkSize, Direction, Directions, ItemFlag, ItemType,} from "@/backend/constants.js";
import {rotate} from "@/util.js";
import {OpCode, TickOp, TickPhase} from "@/backend/core.js";

export const Chunk = `(
    CASE WHEN x < 0 AND x % ${ChunkSize} != 0 THEN x/${ChunkSize} -1 ELSE x/${ChunkSize} END
    || ',' ||
    CASE WHEN y < 0 AND y % ${ChunkSize} != 0 THEN y/${ChunkSize} -1 ELSE y/${ChunkSize} END
)`;

const CoreSchema = `
    CREATE TABLE Port (
        id INTEGER PRIMARY KEY,
        item INT
    );

    CREATE TABLE GameJournal (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        time INTEGER NOT NULL,

        type INTEGER NOT NULL, -- EventType

        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        chunk TEXT GENERATED ALWAYS AS (${Chunk}) VIRTUAL,
        
        objectType INTEGER, -- TODO
        
        id INTEGER, 
        
        a INTEGER,
        b INTEGER,
        c INTEGER
    );
    CREATE INDEX GameJournal_time ON GameJournal(time ASC);
    CREATE INDEX GameJournal_chunk ON GameJournal(chunk);
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

    CREATE TEMPORARY TABLE PortTransferIntent (
        source INT,
        destination INT,
        priority INT CHECK (priority >= 0),
        
        destination_is_empty INT DEFAULT (0)
            CHECK ( destination_is_empty=0 OR destination_is_empty=1 ), 
        
        managed INT DEFAULT (1) -- When set to 0, the GameObject code
                                -- is responsible for actually doing the transfer.
            CHECK ( managed=0 OR managed=1 ),
        
        PRIMARY KEY (source, destination)
    );

    CREATE TEMPORARY TABLE PortTransfer (
        source INTEGER,
        destination INTEGER PRIMARY KEY,
        item INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX PortTransfer_source ON PortTransfer (source);
`;

const CorePragma = `
    PRAGMA foreign_keys=1;
    PRAGMA ignore_check_constraints=0;
    PRAGMA journal_mode=off;
    PRAGMA temp_store=memory;
    PRAGMA optimize=0x10002;
`;

const CoreTriggers = `
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

}

// noinspection SqlWithoutWhere
export class DbSchema {

    /**
     @param ruleSet {RuleSet}
     */
    constructor(ruleSet) {
        this.preparedStatements = {};

        this.tickPhases = {
            [TickPhase.SUBMIT_INTENTS]: [

            ],
            // (Internal)
            [TickPhase.RESOLVE_TRANSFERS]: [
                new TickOp(
                    "ResolvePortTransfer",
                    `WITH RECURSIVE intents AS (
                        -- If there are multiple sources going to the same port, pick the one with the
                        --  highest priority. If they are the same priority, pick the one with the lowest source id
                        SELECT source,
                               destination,
                               destination_is_empty,
                               managed,
                               ROW_NUMBER() OVER (PARTITION BY destination ORDER BY priority DESC, source) AS dst_rank,
                               ROW_NUMBER() OVER (PARTITION BY source ORDER BY priority DESC, destination) AS src_rank
                        FROM PortTransferIntent i
                    ),
                    deduped_intents AS (
                        SELECT source, destination, destination_is_empty, managed
                        FROM intents
                        WHERE src_rank=1 AND dst_rank=1
                    ),
                    resolved_chains AS (
                        SELECT source, destination, managed
                        FROM deduped_intents
                        WHERE destination_is_empty=TRUE

                        UNION ALL

                        -- Get un-resolved upstream ports, recursively
                        SELECT i.source, i.destination, i.managed
                        FROM resolved_chains chain
                            INNER JOIN deduped_intents i ON chain.destination = i.source
                    )
                    INSERT INTO PortTransfer (source, destination, item)
                    SELECT
                        source, destination, src.item
                    FROM resolved_chains
                        INNER JOIN Port src ON src.id = source
                    WHERE managed=TRUE; -- Ignore non-managed transfers`
                ),

                new TickOp(
                    "TruncatePortTransferIntent",
                    `DELETE FROM PortTransferIntent;`
                ),

            ],
            [TickPhase.POST_RESOLVE]: [

            ],
            [TickPhase.COMMIT_TRANSFERS]: [

                // TODO: Optimization; do this in a single UPDATE
                new TickOp(
                    "FlushPortTransferSource",
                    `UPDATE Port
                    SET item=NULL
                    WHERE id IN (SELECT source FROM PortTransfer);`
                ),

                new TickOp(
                    "FlushPortTransferDestination",
                    `UPDATE Port
                    SET item=pt.item
                    FROM PortTransfer pt
                    WHERE Port.id = pt.destination;`
                ),

                new TickOp(
                    "TruncatePortTransfer",
                    `DELETE FROM PortTransfer;`
                ),
            ],
        }
        this.triggers = [CoreTriggers, ...ruleSet.triggers];
        this.initSchema = [CoreSchema, ...ruleSet.initSchema];
        this.tempSchema = [CoreTempSchema, ...ruleSet.tempSchema];
        this.pragma = [CorePragma];

        this._createDeleteTriggers(ruleSet.definitions)
        this._createFanoutTriggers(ruleSet.definitions);

        [
            TickPhase.SUBMIT_INTENTS,
            TickPhase.RESOLVE_TRANSFERS,
            TickPhase.POST_RESOLVE,
            TickPhase.COMMIT_TRANSFERS
        ].forEach(phase => {
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

        if (name === undefined) {
            debugger;
        }

        this.preparedStatements[name] = statement;
    }

    /**
     * @param definitions {Object<string, ObjectDefinition>}
     */
    _prepareInsert(definitions) {

        Object.entries(definitions).forEach(([name, def]) => {
            const ports = [
                ...def.inputPorts.map(p => p.name),
                ...def.outputPorts.map(p => p.name),
                ...def.internalPorts.map(p => p.name),
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

        Object.entries(definitions).forEach(([name, definition]) => {

            if (definition.tickPhases[phase] === undefined) {
                return;
            }

            definition.tickPhases[phase].forEach(op =>
                phaseOps.push(op)
            );
        });

        phaseOps.forEach(op => {
           this._prepare(op.statementName, op.sql);
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

// if (op.op === OpCode.INPUT_TRANSFER) {
//     const def = data.inputTransfers[op.key];
//     const {slot, port, join, where, afterTransfer} = def;
//
//     this._prepare(`${name}_inTx_${i}_prepare`, prepareInputTransfer(name, slot, port, join, where));
//     phaseOps.push(`${name}_inTx_${i}_prepare`);
//
//     this._prepare(`${name}_inTx_${i}_setSlot`, setSlot(name, slot));
//     phaseOps.push(`${name}_inTx_${i}_setSlot`);
//
//     phaseOps.push("CleanPortTransfer");
//
//     if (afterTransfer) {
//         this._prepare(`${name}_inTx_${i}_afterTransfer`, afterTransfer);
//         phaseOps.push(`${name}_inTx_${i}_afterTransfer`);
//     }
//
//     phaseOps.push("TruncatePortTransfer");
//
// } else if (op.op === OpCode.OUTPUT_TRANSFER) {
//     const def = data.outputTransfers[op.key];
//     const {slot, port, join, where, afterTransfer} = def;
//
//     this._prepare(`${name}_outTx_${i}_prepare`, prepareOutputTransfer(name, slot, port, join, where));
//     phaseOps.push(`${name}_outTx_${i}_prepare`);
//
//     this._prepare(`${name}_outTx_${i}_cleanSlot`, cleanSlot(name, slot));
//     phaseOps.push(`${name}_outTx_${i}_cleanSlot`);
//
//     phaseOps.push("SetPort");
//
//     if (afterTransfer) {
//         this._prepare(`${name}_outTx_${i}_afterTransfer`, afterTransfer);
//         phaseOps.push(`${name}_outTx_${i}_afterTransfer`);
//     }
//
//     phaseOps.push("TruncatePortTransfer");
//
// } else if (op.op === OpCode.PORT_TRANSFER) {
//
//     const def = data.portTransfers[op.key];
//     const {inputPort, outputPort, where, join, afterTransfer} = def;
//
//     this._prepare(`${name}_pTx_${i}_prepare`, preparePortTransfer(name, inputPort, outputPort, join, where));
//     phaseOps.push(`${name}_pTx_${i}_prepare`);
//
//     phaseOps.push("SetPort");
//
//     if (afterTransfer) {
//         this._prepare(`${name}_pTx_${i}_afterTransfer`, afterTransfer);
//         phaseOps.push(`${name}_pTx_${i}_afterTransfer`);
//     }
//
//     phaseOps.push("TruncatePortTransfer");
// } else if (op.op === OpCode.STMT) {
//     this._prepare(op.key, data.statements[op.key]);
//     phaseOps.push(op.key);
// } else  {
//     throw new Error("Not Implemented");
// }
