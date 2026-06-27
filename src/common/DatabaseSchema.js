import {TickOp, TickPhase} from "@/common/core.js";
import {CHUNK_SIZE, GameSettingsKey} from "@/common/constants.js";

// The chunk coordinate (floored division, matching JS Math.floor for negatives) of a
// tile-coordinate column.
export const CHUNK_COORD_SQL = (col) =>
    `(CASE WHEN ${col} < 0 AND ${col} % ${CHUNK_SIZE} != 0 THEN ${col}/${CHUNK_SIZE} - 1 ELSE ${col}/${CHUNK_SIZE} END)`;

export const CHUNK_KEY_SQL = `(${CHUNK_COORD_SQL("x")} || ',' || ${CHUNK_COORD_SQL("y")})`;

const CoreStatements = {
    End: "END TRANSACTION",
    Begin: "BEGIN TRANSACTION;",
    Rollback: "ROLLBACK TRANSACTION;",

    InsertSession: "INSERT INTO Session (player_id) VALUES (@player_id) RETURNING id;",
    GetPlayerSettings: `SELECT key, value FROM PlayerSettings WHERE player_id = @player_id;`,
    GetGameSettings: `SELECT key, value FROM GameSettings;`,

    InsertPort: "INSERT INTO Port DEFAULT VALUES RETURNING id;",

    GetSessionEvents: `
        SELECT ev.type, ev.id, ev.a, ev.b, ev.c,
               sv.session_id
        FROM BufferedEvent ev
            INNER JOIN SessionViewport sv ON ev.chunk = sv.chunk
        ORDER BY ev.rowid;
    `,

    TruncateBufferedEvent: `DELETE FROM BufferedEvent;`,

    DeleteSessionViewport: `DELETE FROM SessionViewport WHERE session_id = @session_id RETURNING chunk;`,
    GetSessionViewport: `SELECT chunk FROM SessionViewport WHERE session_id = @session_id;`,
    InsertSessionViewport: `INSERT INTO SessionViewport (session_id, chunk) VALUES (@session_id, @chunk);`,
    DeleteSessionViewportChunk: `DELETE FROM SessionViewport WHERE session_id = @session_id AND chunk = @chunk;`,
    GetSessionsByChunk: `SELECT DISTINCT session_id FROM SessionViewport WHERE chunk = @chunk;`,
}

const CoreSchema = `
    CREATE TABLE PlayerSettings (
        player_id INT NOT NULL,
        key INT NOT NULL,
        value INT NOT NULL,
        PRIMARY KEY (player_id, key)
    ) WITHOUT ROWID;

    CREATE TABLE GameSettings (
        key INTEGER PRIMARY KEY,
        value INT NOT NULL
    );

    CREATE TABLE Port (
        id INTEGER PRIMARY KEY,
        item INT,

        -- Set by a mod when the port is an object's input port. Lets a mod build a
        -- partial index of filled input ports (item IS NOT NULL AND is_in_port = 1)
        -- so a tick can find ports taking input directly.
        is_in_port INT NOT NULL DEFAULT 0
    );

    -- Filled ports — the items resting in ports a mod renders. Sparse (few items sit
    -- in ports at once), so this stays tiny; mods drive their port-item emit off it.
    CREATE INDEX Port_filled ON Port(id) WHERE item IS NOT NULL;

    CREATE TABLE BufferedEvent (
        type INT NOT NULL,

        -- The chunk this event routes to (its position is never sent to the client, which
        -- derives item positions from the path). The chunk key joins SessionViewport.
        routing_chunk_x INT NOT NULL,
        routing_chunk_y INT NOT NULL,
        chunk TEXT GENERATED ALWAYS AS (routing_chunk_x || ',' || routing_chunk_y) VIRTUAL,

        id INT NOT NULL,
        a INT DEFAULT NULL,
        b INT DEFAULT NULL,
        c INT DEFAULT NULL
    );
    CREATE INDEX BufferedEvent_chunk ON BufferedEvent(chunk);
`;

const CoreTempSchema = `
    CREATE TEMPORARY TABLE Numbers (
        value INTEGER PRIMARY KEY NOT NULL
    );

    INSERT INTO Numbers
    WITH RECURSIVE series (value) AS (
        SELECT 0
        UNION ALL
        SELECT value + 1 FROM series WHERE value + 1 < ${CHUNK_SIZE**2}
    )
    SELECT value FROM series;

    INSERT INTO GameSettings (key, value) VALUES
        (${GameSettingsKey.CHUNK_SIZE}, ${CHUNK_SIZE})
        ON CONFLICT DO UPDATE SET value=${CHUNK_SIZE};

    CREATE TEMPORARY TABLE PortTransferIntent (
        source_id INT,
        destination_id INT,
        priority INT CHECK (priority >= 0),

        destination_is_empty INT DEFAULT (0)
            CHECK ( destination_is_empty=0 OR destination_is_empty=1 ),

        managed INT DEFAULT (1) -- When set to 0, the GameObject code
                                -- is responsible for actually doing the transfer.
            CHECK ( managed=0 OR managed=1 ),

        PRIMARY KEY (source_id, destination_id)
    );

    CREATE TEMPORARY TABLE PortTransfer (
        source_id INT,
        destination_id INTEGER PRIMARY KEY,
        -- The item being moved, or NULL for an unmanaged (virtual) transfer the engine
        -- only resolved — the owning mod reads it (managed=0) and does the move itself.
        item INT,
        managed INT NOT NULL
    );
    CREATE UNIQUE INDEX PortTransfer_source ON PortTransfer (source_id);

    CREATE TEMPORARY TABLE Session (
        id INTEGER PRIMARY KEY,
        player_id INT NOT NULL
    );

    CREATE TEMPORARY TABLE SessionViewport (
        session_id INT REFERENCES Session,
        chunk TEXT NOT NULL
    );
`;

const CorePragma = `
    PRAGMA foreign_keys=1;
    PRAGMA ignore_check_constraints=0;
    PRAGMA journal_mode=off;
    PRAGMA temp_store=memory;
    PRAGMA optimize=0x10002;
`;

const CoreTickPhases = {
    [TickPhase.RESOLVE_TRANSFERS]: [
        new TickOp(
            "ResolvePortTransfer",
            `WITH RECURSIVE intents AS (
                SELECT source_id,
                       destination_id,
                       destination_is_empty,
                       managed,
                       priority,
                       ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY priority DESC, destination_id) AS src_rank
                FROM PortTransferIntent i
            ),
            deduped_intents1 AS (
                SELECT source_id, destination_id, destination_is_empty, managed,
                       ROW_NUMBER() OVER (PARTITION BY destination_id ORDER BY priority DESC, source_id) AS dst_rank
                FROM intents
                WHERE src_rank=1
            ),
            deduped_intents2 AS (
                SELECT source_id, destination_id, destination_is_empty, managed
                FROM deduped_intents1
                WHERE dst_rank=1
            ),
            resolved_chains AS (
                -- Resolve backward from a free destination: a transfer can happen if its
                -- destination is empty, or if the transfer draining that destination is
                -- itself resolved (a packed chain shifts as one). UNION (not ALL) so a
                -- cycle terminates.
                SELECT source_id, destination_id, managed
                FROM deduped_intents2
                WHERE destination_is_empty=TRUE

                UNION

                SELECT i.source_id, i.destination_id, i.managed
                FROM resolved_chains chain
                    INNER JOIN deduped_intents2 i ON i.destination_id = chain.source_id
            )
            -- Record every resolved transfer, managed or not. The engine commits the
            -- managed ones below (item moved); unmanaged ones (item left NULL) are read
            -- by the owning mod, which performs its own move.
            INSERT INTO PortTransfer (source_id, destination_id, item, managed)
            SELECT source_id AS source_id,
                   destination_id AS destination_id,
                   CASE WHEN managed THEN src.item END AS item,
                   managed AS managed
            FROM resolved_chains
                -- CROSS JOIN forces resolved_chains (the small transfer set) to drive
                -- the join; otherwise the planner scans the whole Port table.
                CROSS JOIN Port src ON src.id = source_id;`
        ),
        new TickOp("TruncatePortTransferIntent", `DELETE FROM PortTransferIntent;`),
    ],
    [TickPhase.COMMIT_TRANSFERS]: [
        new TickOp(
            "FlushPortTransferSource",
            `UPDATE Port SET item=NULL WHERE id IN (SELECT source_id FROM PortTransfer WHERE managed=1);`
        ),
        new TickOp(
            // Driven from PortTransfer (destination_id is its PRIMARY KEY) instead of
            // UPDATE ... FROM, which made the planner scan the whole Port table. Mirrors
            // FlushPortTransferSource, which already drives from the transfer set.
            "FlushPortTransferDestination",
            `UPDATE Port
             SET item = (SELECT pt.item FROM PortTransfer pt WHERE pt.destination_id = Port.id)
             WHERE id IN (SELECT destination_id FROM PortTransfer WHERE managed=1);`
        ),
        new TickOp("TruncatePortTransfer", `DELETE FROM PortTransfer;`),
    ],
};

export class DatabaseSchema {

    constructor(modRegistry) {
        this.modRegistry = modRegistry;

        this.preparedStatements = {...CoreStatements};
        this.tickPhases = {};

        this.initSchema = [CoreSchema, modRegistry.initSchema];
        this.tempSchema = [CoreTempSchema, modRegistry.tempSchema];
        this.pragma = [CorePragma];

        // Collect statements from all mods
        modRegistry.mods.forEach(mod => {
            if (mod.statements) {
                Object.assign(this.preparedStatements, mod.statements);
            }
        });

        // Register core tick phase operations
        Object.entries(CoreTickPhases).forEach(([phase, ops]) => {
            this.tickPhases[phase] ||= [];
            ops.forEach(op => {
                this._prepare(op.statementName, op.sql);
                this.tickPhases[phase].push(op);
            });
        });

        [
            TickPhase.SUBMIT_INTENTS,
            TickPhase.RESOLVE_TRANSFERS,
            TickPhase.POST_RESOLVE,
            TickPhase.COMMIT_TRANSFERS
        ].forEach(phase => {
            this._prepareTick(this.modRegistry.definitions, phase);
        });

    }

    /**
     * @param definitions {Object<string, ObjectDefinition>}
     * @param phase {TickPhase}
     */
    _prepareTick(definitions, phase) {

        this.tickPhases[phase] ||= [];

        Object.entries(definitions).forEach(([name, definition]) => {

            if (definition.tickPhases[phase] === undefined) {
                return;
            }

            definition.tickPhases[phase].forEach(op => {
                this._prepare(op.statementName, op.sql);
                this.tickPhases[phase].push(op);
            });
        });
    }

    _prepare(name, statement) {

        if (name === undefined) {
            throw new Error(`Cannot prepare statement with no name: ${statement}`);
        }

        this.preparedStatements[name] = statement;
    }
}