import {TickOp, TickPhase} from "@/common/core.js";
import {CHUNK_SIZE, GameSettingsKey} from "@/common/constants.js";

// TODO: Rename foreign key columns to use _id suffix (e.g., session -> session_id) at end of refactor.

const CoreStatements = {
    End: "END TRANSACTION",
    Begin: "BEGIN TRANSACTION;",
    Rollback: "ROLLBACK TRANSACTION;",

    InsertSession: "INSERT INTO Session (user) VALUES (@user) RETURNING id;",
    GetPlayerSettings: `SELECT key, value FROM PlayerSettings WHERE player = @player;`,
    GetGameSettings: `SELECT key, value FROM GameSettings;`,

    InsertPort: "INSERT INTO Port DEFAULT VALUES RETURNING id;",
    InsertGameJournal: `
        INSERT INTO GameJournal (time, type, subtype, x, y, id, a, b, c)
        VALUES (@time, @type, @subtype, @x, @y, @id, @a, @b, @c);
    `,

    GetSessionEvents: `
        SELECT ev.seq, ev.time, ev.type, ev.subtype, ev.x, ev.y, ev.chunk, ev.id, ev.a, ev.b, ev.c,
               sv.session
        FROM GameJournal ev
            INNER JOIN SessionViewport sv ON ev.chunk = sv.chunk;
    `,

    TruncateGameJournal: `DELETE FROM GameJournal;`,

    DeleteSessionViewport: `DELETE FROM SessionViewport WHERE session = @session RETURNING chunk;`,
    InsertSessionViewport: `INSERT INTO SessionViewport (session, chunk) VALUES (@session, @chunk);`,
    GetSessionsByChunk: `SELECT session FROM SessionViewport WHERE chunk = @chunk;`,
}

export const CHUNK_KEY_SQL = `(
    CASE WHEN x < 0 AND x % ${CHUNK_SIZE} != 0 THEN x/${CHUNK_SIZE} -1 ELSE x/${CHUNK_SIZE} END
    || ',' ||
    CASE WHEN y < 0 AND y % ${CHUNK_SIZE} != 0 THEN y/${CHUNK_SIZE} -1 ELSE y/${CHUNK_SIZE} END
)`;

const CoreSchema = `
    CREATE TABLE PlayerSettings (
        player INT NOT NULL,
        key INT NOT NULL,
        value INT NOT NULL,
        PRIMARY KEY (player, key)
    ) WITHOUT ROWID;

    CREATE TABLE Port (
        id INTEGER PRIMARY KEY,
        item INT
    );

    CREATE TABLE GameJournal (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        time INT NOT NULL,

        type INT NOT NULL,
        subtype INT NOT NULL,

        x INT NOT NULL,
        y INT NOT NULL,
        chunk TEXT GENERATED ALWAYS AS (${CHUNK_KEY_SQL}) VIRTUAL,

        id INT NOT NULL,
        a INT,
        b INT,
        c INT
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
        SELECT value + 1 FROM series WHERE value + 1 < ${CHUNK_SIZE**2}
    )
    SELECT value FROM series;

    CREATE TEMPORARY TABLE GameSettings (
        key INTEGER PRIMARY KEY,
        value INT NOT NULL
    );

    INSERT INTO GameSettings (key, value) VALUES
        (${GameSettingsKey.CHUNK_SIZE}, ${CHUNK_SIZE});

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
        source INT,
        destination INTEGER PRIMARY KEY,
        item INT NOT NULL
    );
    CREATE UNIQUE INDEX PortTransfer_source ON PortTransfer (source);

    CREATE TEMPORARY TABLE Session (
        id INTEGER PRIMARY KEY,
        user INT NOT NULL
    );

    CREATE TEMPORARY TABLE SessionViewport (
        session INT REFERENCES Session,
        chunk TEXT NOT NULL
    );

--     INSERT INTO Game(id, time) VALUES (0, 0);
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
                SELECT source,
                       destination,
                       destination_is_empty,
                       managed,
                       priority,
                       ROW_NUMBER() OVER (PARTITION BY source ORDER BY priority DESC, destination) AS src_rank
                FROM PortTransferIntent i
            ),
            deduped_intents1 AS (
                SELECT source, destination, destination_is_empty, managed,
                       ROW_NUMBER() OVER (PARTITION BY destination ORDER BY priority DESC, source) AS dst_rank
                FROM intents
                WHERE src_rank=1
            ),
            deduped_intents2 AS (
                SELECT source, destination, destination_is_empty, managed
                FROM deduped_intents1
                WHERE dst_rank=1
            ),
            resolved_chains AS (
                SELECT source, destination, managed
                FROM deduped_intents2
                WHERE destination_is_empty=TRUE

                UNION ALL

                SELECT i.source, i.destination, i.managed
                FROM resolved_chains chain
                    INNER JOIN deduped_intents2 i ON chain.destination = i.source
            )
            INSERT INTO PortTransfer (source, destination, item)
            SELECT source, destination, src.item
            FROM resolved_chains
                INNER JOIN Port src ON src.id = source
            WHERE managed=TRUE;`
        ),
        new TickOp("TruncatePortTransferIntent", `DELETE FROM PortTransferIntent;`),
    ],
    [TickPhase.COMMIT_TRANSFERS]: [
        new TickOp(
            "FlushPortTransferSource",
            `UPDATE Port SET item=NULL WHERE id IN (SELECT source FROM PortTransfer);`
        ),
        new TickOp(
            "FlushPortTransferDestination",
            `UPDATE Port SET item=pt.item FROM PortTransfer pt WHERE Port.id = pt.destination;`
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
        this.triggers = modRegistry.mods
            .map(mod => mod.triggers)
            .filter(t => t && t.trim().length > 0);

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