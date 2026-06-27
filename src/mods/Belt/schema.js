import {CHUNK_KEY_SQL} from "@/sdk/common.js";
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

        in_port_id INT REFERENCES Port(id) ON DELETE SET NULL
            CHECK (in_port_id IS NULL OR in_port_id != out_port_id),

        out_port_id INT REFERENCES Port(id) ON DELETE SET NULL
            CHECK (out_port_id IS NULL OR in_port_id != out_port_id),

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

        chunk TEXT GENERATED ALWAYS AS (${CHUNK_KEY_SQL}) VIRTUAL,

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

    -- Partial indexes that let a tick enumerate only the paths that can do work.
    -- A path is "active" if it can pop (has an item ready), is shuffling a gap, or
    -- is taking input (see ActivePath build).
    CREATE INDEX BeltPath_next_item ON BeltPath(id) WHERE next_item_id IS NOT NULL;
    CREATE INDEX BeltPath_next_gap  ON BeltPath(id) WHERE next_gap_id IS NOT NULL;

    -- Enumerates only the *filled* in-ports (core Port.is_in_port is set when a path is
    -- wired, see MarkPortAsInput), so the tick's input-activation reads just the in-ports
    -- holding an item. SQLite re-checks the partial
    -- predicate on every Port.item write, so a newly filled in-port enters the index no
    -- matter which code path filled it.
    CREATE INDEX Port_in_filled ON Port(id) WHERE item IS NOT NULL AND is_in_port = 1;

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

    INSERT INTO GameSettings (key, value) VALUES
        (${BeltGameSettingsKey.MAX_UNDERGROUND_LENGTH}, ${MAX_UNDERGROUND_LENGTH});
`;
