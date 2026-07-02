import {CHUNK_ID_SQL} from "@/sdk/common.js";
import {
    BELT_UNDERGROUND,
    BeltGameSettingsKey,
    ITEM_TYPE_GAP,
    MAX_UNDERGROUND_LENGTH,
} from "./constants.js";

// Permanent tables owned by the Belt mod.
export const beltSchema = `
    CREATE TABLE BeltPath (
        id INTEGER PRIMARY KEY REFERENCES Belt(id),
        tail_id INT UNIQUE REFERENCES Belt(id),
        length INT,

        head_gap INT
            CHECK (head_gap >= 0 AND head_gap <= length),

        -- A loop shares one port for both ends (in_port_id = out_port_id): the lead item
        -- pops into it and the tail re-ingests it, so items circulate.
        in_port_id INT REFERENCES Port(id) ON DELETE SET NULL,

        out_port_id INT REFERENCES Port(id) ON DELETE SET NULL,

        next_gap_id INT,
        next_item_id INT
    );
    CREATE INDEX BeltPath_ports ON BeltPath(in_port_id, out_port_id);
    -- out_port_id needs its own leading index: the composite above only serves
    -- in_port_id lookups, so without this every Port delete full-scans BeltPath to
    -- honor the out_port_id ON DELETE SET NULL action (and out_port_id = ? filters).
    CREATE INDEX BeltPath_out_port ON BeltPath(out_port_id);

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

        chunk INT GENERATED ALWAYS AS (${CHUNK_ID_SQL}) VIRTUAL,

        direction INT NOT NULL
    );

    CREATE UNIQUE INDEX Belt_x_y_surface    ON Belt(x, y) WHERE type != ${BELT_UNDERGROUND};
    -- Two undergrounds may share a tile only when they run on different axes (a
    -- crossing tunnel): direction % 2 is the axis (0 = vertical, 1 = horizontal), so
    -- a perpendicular pair coexists while a same-axis overlap still conflicts.
    CREATE UNIQUE INDEX Belt_x_y_underground ON Belt(x, y, (direction % 2)) WHERE type = ${BELT_UNDERGROUND};
    -- The two indexes above are partial, so SQLite can't use them for the many
    -- position lookups (port/parent/neighbor queries) that don't carry a matching
    -- type predicate. This plain index serves those lookups regardless of type;
    -- the partials still enforce the per-tile uniqueness rules.
    CREATE INDEX Belt_x_y ON Belt(x, y);
    CREATE INDEX Belt_path ON Belt(path_id, path_index);
    -- Lets viewport-gated tick ops find the belts in watched chunks directly, instead
    -- of scanning every belt (or every filled port) and filtering by chunk afterward.
    CREATE INDEX Belt_chunk ON Belt(chunk);

    -- Partial indexes that let a tick enumerate only the paths that can do work.
    -- A path is "active" if it can pop (has an item ready), is shuffling a gap, or
    -- is taking input (see ActivePath build).
    CREATE INDEX BeltPath_next_item ON BeltPath(id) WHERE next_item_id IS NOT NULL;
    CREATE INDEX BeltPath_next_gap  ON BeltPath(id) WHERE next_gap_id IS NOT NULL;

    -- Enumerates only the *filled* in-ports (core Port.is_input_port is set when a path is
    -- wired, see MarkPortAsInput), so the tick's input-activation reads just the in-ports
    -- holding an item. SQLite re-checks the partial
    -- predicate on every Port.item write, so a newly filled in-port enters the index no
    -- matter which code path filled it.
    CREATE INDEX Port_in_filled ON Port(id) WHERE item IS NOT NULL AND is_input_port = 1;

    CREATE TABLE BeltPathItem (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        path_id INT NOT NULL REFERENCES BeltPath,
        length INT NOT NULL CHECK (length >= 0),

        type INT NOT NULL CHECK (type >= 0)
    );

    -- One index on path_id serves every per-path item lookup (delete/stash/trim/
    -- transfer/sum) plus the BeltPath ON DELETE FK.
    CREATE INDEX BeltPathItem_path ON BeltPathItem(path_id);

    -- Type-split partial indexes so the tick's next-item / next-gap recompute is an
    -- O(1) leftmost lookup per path (MIN(id) WHERE path_id = ? AND type ...). The id is
    -- the rowid, and each
    -- index is ordered (path_id, id), so the first entry for a path is its MIN id.
    CREATE INDEX BeltPathItem_next_item ON BeltPathItem(path_id) WHERE type != ${ITEM_TYPE_GAP};
    CREATE INDEX BeltPathItem_next_gap  ON BeltPathItem(path_id) WHERE type =  ${ITEM_TYPE_GAP};
    -- Items only sit at length 0 transiently (a gap a tick is consuming, about to be
    -- deleted). This partial index lets the tick collect those paths directly; it
    -- stays tiny because almost no rows match.
    CREATE INDEX BeltPathItem_zero ON BeltPathItem(path_id) WHERE length = 0;

    -- A 1x2 router: two input and two output ports sharing Port rows with adjacent
    -- belts. Items from in_A round-robin to out_A/out_B; items from in_B to out_B/out_A
    -- (inverse), falling back to the other output when the preferred one can't take it.
    -- The round-robin phase is the single state bit, advanced once per tick a move runs.
    -- The two internal ports buffer an item for a tick (in -> int -> out), so it crosses
    -- the splitter at belt speed (three ticks) rather than teleporting input to output.
    CREATE TABLE Splitter (
        id INTEGER PRIMARY KEY,

        x INT NOT NULL,
        y INT NOT NULL,
        direction INT NOT NULL,
        chunk INT GENERATED ALWAYS AS (${CHUNK_ID_SQL}) VIRTUAL,

        in_a_id  INT REFERENCES Port,
        in_b_id  INT REFERENCES Port,
        out_a_id INT REFERENCES Port,
        out_b_id INT REFERENCES Port,
        int_a_id INT REFERENCES Port,
        int_b_id INT REFERENCES Port,

        state INT NOT NULL DEFAULT 0
            CHECK (state = 0 OR state = 1)
    );

    CREATE UNIQUE INDEX Splitter_x_y_direction ON Splitter (x, y, direction);

    -- Find the splitters in watched chunks directly (chunk sync + the per-tick out-port
    -- item capture), instead of scanning every splitter.
    CREATE INDEX Splitter_chunk ON Splitter(chunk);
`;

// Per-run temp tables and seed rows owned by the Belt mod.
export const beltTempSchema = `
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

    -- Paths whose next_item_id may have moved this tick: an item was popped (its min
    -- non-gap row removed) or ingested (a non-gap row added). The next_item recalc
    -- touches only these; PRIMARY KEY dedups the INSERT OR IGNOREs.
    CREATE TEMPORARY TABLE ChangedPath (
        path_id INTEGER PRIMARY KEY
    );

    -- Paths whose next_gap_id may have moved this tick: a gap was consumed to nothing
    -- (its min gap row deleted) or a fresh gap was ingested. A resize only changes a
    -- gap's length, not its id, so it never lands here. Usually far smaller than
    -- ChangedPath, so the next_gap recalc stays cheap.
    CREATE TEMPORARY TABLE GapChangedPath (
        path_id INTEGER PRIMARY KEY
    );

    -- The paths a tick needs to process at all: rebuilt at the start of each tick
    -- from the partial indexes above so the movement ops touch only live paths
    -- instead of every path. PRIMARY KEY dedups the union inserts.
    CREATE TEMPORARY TABLE ActivePath (
        path_id INTEGER PRIMARY KEY
    );

    CREATE TEMPORARY TABLE BeltPathOutputItem (
        path_id INTEGER PRIMARY KEY,
        port_id INT NOT NULL,
        item_id INT NOT NULL,
        item_type INT NOT NULL
    );

    -- The BeltPathItem rows mutated this tick (resized, popped, or inserted) in a
    -- watched chunk, with their path and head tile. The captures gate on viewport, so
    -- the emit ops just fan these out (no Belt join, no chunk filter): still in
    -- BeltPathItem -> UPSERT, gone -> DELETE.
    CREATE TEMPORARY TABLE ChangedItem (
        row_id INTEGER PRIMARY KEY,
        path_id INT,
        x INT,
        y INT
    );

    -- The lead gaps Case1 shrinks this tick (all active paths, unwatched included):
    -- the sim resizes from here, and the watched subset is captured into ChangedItem.
    CREATE TEMPORARY TABLE ResizeGap (
        row_id INTEGER PRIMARY KEY,
        path_id INT
    );

    -- Paths whose item rows the client must re-sync in full (a belt edit rebuilt
    -- them under new ids, or a new viewer subscribed). Flushed each tick as a full
    -- RLE of UPSERTs.
    CREATE TEMPORARY TABLE ResyncItemPath (
        path_id INTEGER PRIMARY KEY
    );

    -- Single-row marker holding the max BeltPathItem id before InsertItem runs, so
    -- the rows it inserts (higher ids, AUTOINCREMENT) can be captured afterward.
    CREATE TEMPORARY TABLE ItemIdMarker (
        max_id INT
    );
    INSERT INTO ItemIdMarker (max_id) VALUES (0);

    -- Carry each splitter's two resolved hops between the POST_RESOLVE seam ops that
    -- read a source port and the later ones that write the destination. Stage 1 buffers
    -- an input into an internal port; stage 2 routes an internal port to an output. Both
    -- destinations are unique per tick (the resolver allows one transfer per destination).
    -- Port columns are plain (not INTEGER PRIMARY KEY): the FillStage ops join Port on these,
    -- and an aliased rowid here would let SQLite drive that join from the whole Port table
    -- (a full scan per tick) instead of scanning these few per-tick rows. Uniqueness is
    -- guaranteed by construction (each splitter contributes two globally-unique port ids).
    CREATE TEMPORARY TABLE SplitterStage1 (
        int_port_id INT NOT NULL,
        item INT NOT NULL,
        in_port_id INT NOT NULL
    );

    CREATE TEMPORARY TABLE SplitterStage2 (
        out_port_id INT NOT NULL,
        item INT NOT NULL,
        int_port_id INT NOT NULL
    );

    INSERT INTO GameSettings (key, value) VALUES
        (${BeltGameSettingsKey.MAX_UNDERGROUND_LENGTH}, ${MAX_UNDERGROUND_LENGTH});
`;
