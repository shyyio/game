import {SqlStatement, TickPhase} from "@/common/core.js";
import {
    CHUNK_SIZE,
    GameSettingsKey,
    Direction,
    BUFFERED_EVENT_TYPE_PORT_ITEM_SET,
    BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR,
} from "@/common/constants.js";

// Statement-name suffix per direction (GetInPortUp, GetOutPortRight, ...), indexed by Direction.
const DIRECTION_NAMES = ["Up", "Right", "Down", "Left"];

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

    // Garbage-collects a port once nothing references it (guard filled from every definition's
    // port columns, see _substitutePortReferenceTokens), so port removal needs no per-table knowledge.
    DeletePortIfUnreferenced: "DELETE FROM Port WHERE id = CAST(@port AS INT) AND NOT EXISTS ({{PORT_REFERENCED}});",

    // Allocates the next global object id (see the ObjectId table). Mods call this and insert
    // the object with the returned id, instead of relying on per-table autoincrement.
    AllocateObjectId: "UPDATE ObjectId SET next = next + 1 RETURNING next;",

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

    -- A single global id sequence shared by every placeable object (belts, splitters, …), so
    -- object ids are unique across types and a later id means a later placement. Comparing ids
    -- across object types is how connections resolve "most recently placed wins". (A future
    -- sharded build can band this per region: region id high bits + sequence low bits.)
    CREATE TABLE ObjectId (next INTEGER NOT NULL);
    INSERT INTO ObjectId (next) VALUES (0);

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

        -- A NULL destination flags a self-draining source instead of a move: source_id is a
        -- port its owner empties internally this tick (e.g. a belt ingesting into head room
        -- without popping), so an upstream transfer into it still resolves through the chain
        -- even though no transfer drains it. Such rows skip the per-destination dedup and
        -- never become an actual move; a real transfer always names a destination.
        destination_id INT,

        destination_is_empty INT DEFAULT (0)
            CHECK ( destination_is_empty=0 OR destination_is_empty=1 ),

        managed INT DEFAULT (1) -- When set to 0, the GameObject code
                                -- is responsible for actually doing the transfer.
            CHECK ( managed=0 OR managed=1 ),

        -- The item the destination receives, overriding the source's item (a machine translating
        -- its input to a product, or — with a NULL source — creating one). NULL moves it unchanged.
        output_item INT,

        -- NULL for an ordinary transfer with a single destination. A fan-out source (one
        -- that submits a competing intent per candidate destination, e.g. a splitter) ranks
        -- them 1, 2, ...: the lowest rank wins both the per-destination dedup (which source
        -- gets a contested destination) and the post-chain per-source pick (which
        -- destination a source keeps). Its presence (NOT NULL) is also what opts a row into
        -- that per-source pick, so single-destination sources skip that window entirely.
        alternatives_rank INT,

        PRIMARY KEY (source_id, destination_id)
    );

    CREATE TEMPORARY TABLE ResolvedPortTransfer (
        source_id INT,
        destination_id INTEGER PRIMARY KEY,
        -- The item being moved, or NULL for an unmanaged (virtual) transfer the engine
        -- only resolved — the owning mod reads it (managed=0) and does the move itself.
        item INT,
        managed INT NOT NULL
    );
    CREATE UNIQUE INDEX ResolvedPortTransfer_source ON ResolvedPortTransfer (source_id);

    -- Sources of resolved sink intents (managed, destination-less): items the engine consumes
    -- (clears) this tick without a destination. Drained in COMMIT_TRANSFERS.
    CREATE TEMPORARY TABLE ResolvedSink (
        source_id INTEGER PRIMARY KEY
    );

    CREATE TEMPORARY TABLE Session (
        id INTEGER PRIMARY KEY,
        player_id INT NOT NULL
    );

    CREATE TEMPORARY TABLE SessionViewport (
        session_id INT REFERENCES Session,
        chunk TEXT NOT NULL
    );

    -- This tick's watched filled out-ports (port, item, routing tile), gathered by each mod's
    -- capture op for the SET/CLEAR diff and shadow rebuild to share.
    CREATE TEMPORARY TABLE ViewedPortItem (
        port_id INTEGER PRIMARY KEY,
        item INT,
        x INT,
        y INT
    );

    -- Last item shown in each watched out-port (with the routing tile for clears), so the tick
    -- emits only out-ports whose item changed. Global to the sim -- fine single-session; a
    -- multi-session build would key it per session.
    CREATE TEMPORARY TABLE PortItemShadow (
        port_id INTEGER PRIMARY KEY,
        item INT,
        x INT,
        y INT
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
        new SqlStatement(
                "ResolvePortTransfer",
            `WITH RECURSIVE ranked_per_destination AS (
                -- Rank contenders for each destination (a port takes one item): lowest
                -- alternatives_rank wins, ties by source_id. A NULL rank (single-destination
                -- sources) sorts first -- harmless, they only share a partition with each other.
                SELECT
                    source_id,
                    destination_id,
                    destination_is_empty,
                    managed,
                    alternatives_rank,
                    output_item,
                    ROW_NUMBER() OVER (PARTITION BY destination_id ORDER BY alternatives_rank ASC, source_id) AS dst_rank
                FROM PortTransferIntent
                WHERE destination_id IS NOT NULL
            ),
            one_per_destination AS (
                SELECT source_id, destination_id, destination_is_empty, managed, alternatives_rank, output_item
                FROM ranked_per_destination
                WHERE dst_rank=1
            ),
            resolved AS (
                -- A transfer resolves if its destination is empty...
                SELECT source_id, destination_id, managed, alternatives_rank, output_item
                FROM one_per_destination
                WHERE destination_is_empty=TRUE

                UNION

                -- ...or its source drains this tick: a destination-less row marking a port emptied
                -- without a transfer to show it — an unmanaged self-drain (a belt ingesting into head
                -- room, the owner clears it) or a managed sink (the engine clears it, in CONSUME_INPUTS
                -- before producers refill). Either way it lets an upstream transfer into that port
                -- resolve. Only source_id matters; filtered out before the move below.
                SELECT source_id, NULL, NULL, NULL, NULL
                FROM PortTransferIntent
                WHERE destination_id IS NULL

                UNION

                -- ...or the transfer draining its destination resolves (a packed chain
                -- shifts as one). UNION (not ALL) terminates cycles.
                SELECT i.source_id, i.destination_id, i.managed, i.alternatives_rank, i.output_item
                FROM resolved chain
                    INNER JOIN one_per_destination i ON i.destination_id = chain.source_id
            ),
            one_per_source AS (
                -- Single-destination sources (belts) pass through. A fan-out source keeps
                -- only its best-ranked resolved destination -- a dedup over just the tiny
                -- fan-out set, so belts pay no extra sort.
                SELECT source_id, destination_id, managed, output_item
                FROM resolved
                WHERE alternatives_rank IS NULL AND destination_id IS NOT NULL

                UNION ALL

                SELECT source_id, destination_id, managed, output_item
                FROM (
                    SELECT source_id, destination_id, managed, output_item,
                           ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY alternatives_rank ASC, destination_id) AS src_rank
                    FROM resolved
                    WHERE alternatives_rank IS NOT NULL
                )
                WHERE src_rank=1
            )
            -- Commit each resolved transfer. Managed ones carry the item the destination receives:
            -- output_item if set (a translation, or a creation when there is no source), else the
            -- source's own item. Unmanaged ones leave it NULL for the owning mod to move itself.
            INSERT INTO ResolvedPortTransfer (source_id, destination_id, item, managed)
            SELECT ops.source_id,
                   ops.destination_id,
                   CASE WHEN ops.managed THEN COALESCE(ops.output_item, src.item) END AS item,
                   ops.managed
            FROM one_per_source ops
                -- LEFT JOIN (not CROSS) so a source-less create still commits; drives from the
                -- small transfer set with an indexed rowid lookup, so the plan is unchanged.
                LEFT JOIN Port src ON src.id = ops.source_id;`

        ),
        new SqlStatement(
            // Sinks (managed, destination-less) always resolve — there is no destination to gate
            // on. Capture their sources before the intents are truncated; CONSUME_INPUTS clears them.
            "CaptureResolvedSinks",
            `INSERT OR IGNORE INTO ResolvedSink (source_id)
             SELECT source_id FROM PortTransferIntent WHERE destination_id IS NULL AND managed = 1;`
        ),
        new SqlStatement("TruncatePortTransferIntent", `DELETE FROM PortTransferIntent;`),
    ],
    [TickPhase.CONSUME_INPUTS]: [
        new SqlStatement(
            // Consume sunk items here, before producers (belts) refill the ports in POST_RESOLVE, so
            // an upstream item shifts forward into the freed port the same tick.
            "FlushResolvedSink",
            `UPDATE Port SET item=NULL WHERE id IN (SELECT source_id FROM ResolvedSink);`
        ),
    ],
    [TickPhase.COMMIT_TRANSFERS]: [
        new SqlStatement(
            "FlushResolvedPortTransferSource",
            `UPDATE Port SET item=NULL WHERE id IN (SELECT source_id FROM ResolvedPortTransfer WHERE managed=1);`
        ),
        new SqlStatement(
            // Driven from ResolvedPortTransfer (destination_id is its PRIMARY KEY) instead of
            // UPDATE ... FROM, which made the planner scan the whole Port table. Mirrors
            // FlushResolvedPortTransferSource, which already drives from the transfer set.
            "FlushResolvedPortTransferDestination",
            `UPDATE Port
             SET item = (SELECT pt.item FROM ResolvedPortTransfer pt WHERE pt.destination_id = Port.id)
             WHERE id IN (SELECT destination_id FROM ResolvedPortTransfer WHERE managed=1);`
        ),
        new SqlStatement("TruncateResolvedPortTransfer", `DELETE FROM ResolvedPortTransfer;`),
        new SqlStatement("TruncateResolvedSink", `DELETE FROM ResolvedSink;`),
        // Clear the render staging before mods capture this tick's watched out-ports into it.
        new SqlStatement("ClearViewedPortItem", `DELETE FROM ViewedPortItem;`),
    ],
};

// Core ops appended after every mod's tick ops, so they run on the rows mods produced this phase.
// The out-port render diff reads ViewedPortItem (filled by mod capture ops) against the shadow.
const CoreTickPhasesTrailing = {
    [TickPhase.COMMIT_TRANSFERS]: [
        // SET for each out-port whose resting item changed (diff vs PortItemShadow). Carries only
        // the port id (a=item type); the client infers the render tile. x/y is the routing tile.
        new SqlStatement(
            "EmitPortItemSet",
            `INSERT INTO BufferedEvent (type, routing_chunk_x, routing_chunk_y, id, a, b, c)
             SELECT ${BUFFERED_EVENT_TYPE_PORT_ITEM_SET}, ${CHUNK_COORD_SQL("v.x")}, ${CHUNK_COORD_SQL("v.y")}, v.port_id, v.item, NULL, NULL
             FROM ViewedPortItem v
                LEFT JOIN PortItemShadow s ON s.port_id = v.port_id
             WHERE s.port_id IS NULL OR s.item != v.item;`
        ),
        new SqlStatement(
            "EmitPortItemClear",
            `INSERT INTO BufferedEvent (type, routing_chunk_x, routing_chunk_y, id, a, b, c)
             SELECT ${BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR}, ${CHUNK_COORD_SQL("s.x")}, ${CHUNK_COORD_SQL("s.y")}, s.port_id, NULL, NULL, NULL
             FROM PortItemShadow s
             WHERE s.port_id NOT IN (SELECT port_id FROM ViewedPortItem);`
        ),
        new SqlStatement("ClearPortItemShadow", `DELETE FROM PortItemShadow;`),
        new SqlStatement(
            "RebuildPortItemShadow",
            `INSERT INTO PortItemShadow (port_id, item, x, y)
             SELECT v.port_id, v.item, v.x, v.y
             FROM ViewedPortItem v;`
        ),
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

        // Leading core ops, then mod ops, then trailing core ops -- so a trailing op (the out-port
        // render diff) runs on the rows mod capture ops produced this phase.
        this._registerCoreTickPhases(CoreTickPhases);

        [
            TickPhase.SUBMIT_INTENTS,
            TickPhase.RESOLVE_TRANSFERS,
            TickPhase.CONSUME_INPUTS,
            TickPhase.POST_RESOLVE,
            TickPhase.PRODUCE_OUTPUTS,
            TickPhase.COMMIT_TRANSFERS
        ].forEach(phase => {
            this._prepareTick(this.modRegistry.definitions, phase);
        });

        this._prepareRenderCapture(this.modRegistry.definitions);
        this._registerCoreTickPhases(CoreTickPhasesTrailing);

        this._preparePortQueries(this.modRegistry.definitions);
        this._prepareOccupancyQuery(this.modRegistry.definitions);
        this._substitutePortReferenceTokens(this.modRegistry.definitions);
    }

    /**
     * @param phases {Object.<TickPhase, SqlStatement[]>}
     * @returns {void}
     */
    _registerCoreTickPhases(phases) {
        Object.entries(phases).forEach(([phase, ops]) => {
            this.tickPhases[phase] ||= [];
            ops.forEach(op => {
                this._prepare(op.statementName, op.sql);
                this.tickPhases[phase].push(op);
            });
        });
    }

    /**
     * Generates the COMMIT_TRANSFERS capture op for each definition with render-flagged out-ports:
     * gathers their watched filled ports into ViewedPortItem, routed by the object's own tile.
     * @param {Object<string, ObjectDefinition>} definitions
     * @returns {void}
     */
    _prepareRenderCapture(definitions) {
        this.tickPhases[TickPhase.COMMIT_TRANSFERS] ||= [];
        Object.entries(definitions).forEach(([table, definition]) => {
            const renderedPorts = definition.outputPorts.filter(port => port.render);
            if (renderedPorts.length === 0) {
                return;
            }
            const branches = renderedPorts.map(port => `
                SELECT p.id, p.item, o.x, o.y
                FROM viewed_chunk vc
                    CROSS JOIN ${table} o INDEXED BY ${table}_chunk ON o.chunk = vc.chunk
                    CROSS JOIN Port p ON p.id = o.${port.column}
                WHERE p.item IS NOT NULL`);
            const op = new SqlStatement(
                `Capture${table}PortItems`,
                `WITH viewed_chunk AS (SELECT DISTINCT chunk FROM SessionViewport)
                 INSERT INTO ViewedPortItem (port_id, item, x, y)
                 ${branches.join("\nUNION ALL\n")};`
            );
            this._prepare(op.statementName, op.sql);
            this.tickPhases[TickPhase.COMMIT_TRANSFERS].push(op);
        });
    }

    /**
     * Fills the {{PORT_REFERENCED}} / {{PORT_OUTPUT_REFERENCED}} tokens in every prepared statement
     * with the UNION of every definition's port-reference fragments, so the GC guards cover all
     * object types generically. Run last, after every statement is assembled.
     * @param {Object<string, ObjectDefinition>} definitions
     */
    _substitutePortReferenceTokens(definitions) {
        const referenced = [];
        const outputReferenced = [];
        Object.entries(definitions).forEach(([table, definition]) => {
            referenced.push(...definition.portReferenceLookups(table));
            outputReferenced.push(...definition.outputPortReferenceLookups(table));
        });
        const body = (fragments) =>
            fragments.length === 0 ? "SELECT 1 WHERE 0" : fragments.join("\nUNION ALL\n");
        const referencedBody = body(referenced);
        const outputReferencedBody = body(outputReferenced);

        Object.keys(this.preparedStatements).forEach(name => {
            this.preparedStatements[name] = this.preparedStatements[name]
                .replaceAll("{{PORT_OUTPUT_REFERENCED}}", outputReferencedBody)
                .replaceAll("{{PORT_REFERENCED}}", referencedBody);
        });
    }

    /**
     * Prepares IsOccupied(@x, @y, @layer): the UNION of every ObjectDefinition's occupancy
     * fragments, returning 1 if any object covers that tile on that layer. Placement checks
     * each of a new object's geometry cells against it to reject overlaps (block + warn) —
     * a backstop against malicious or desynced clients, not a hot path.
     * @param {Object<string, ObjectDefinition>} definitions
     */
    _prepareOccupancyQuery(definitions) {
        const clauses = [];
        Object.entries(definitions).forEach(([table, definition]) => {
            clauses.push(...definition.occupancyLookups(table));
        });
        const body = clauses.length === 0 ? "SELECT 1 WHERE 0" : clauses.join("\nUNION ALL\n");
        this._prepare("IsOccupied", `${body}\nLIMIT 1;`);
    }

    /**
     * Prepares the position-based port lookups (GetInPort{dir} / GetOutPort{dir}) for wiring
     * a placed object to its neighbours: each UNIONs every ObjectDefinition's fragments, so a
     * placement sees any object type's ports at a tile. Player-placement path only, not hot.
     * @param {Object<string, ObjectDefinition>} definitions
     */
    _preparePortQueries(definitions) {
        DIRECTION_NAMES.forEach((name, direction) => {
            this._prepare(`GetInPort${name}`, this._portQuery(definitions, "inputPorts", direction));
            this._prepare(`GetOutPort${name}`, this._portQuery(definitions, "outputPorts", direction));
        });
    }

    /**
     * @param {Object<string, ObjectDefinition>} definitions
     * @param {("inputPorts"|"outputPorts")} portKind
     * @param {Direction} direction
     * @returns {string}
     */
    _portQuery(definitions, portKind, direction) {
        const clauses = [];
        Object.entries(definitions).forEach(([table, definition]) => {
            clauses.push(...definition.portLookups(table, portKind, direction));
        });
        // No object has a port of this kind: match nothing.
        if (clauses.length === 0) {
            return "SELECT NULL AS id WHERE 0;";
        }
        return `${clauses.join("\nUNION ALL\n")};`;
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