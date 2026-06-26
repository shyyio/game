import {CHUNK_KEY_SQL} from "@/sdk/common.js";
import {
    BELT_UNDERGROUND,
    BeltGameSettingsKey,
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

    -- Partial indexes that let a tick enumerate only the paths that can do work,
    -- instead of scanning every path. A path is "active" if it can pop (has an
    -- item ready), is shuffling a gap, or is taking input (see ActivePath build).
    CREATE INDEX BeltPath_next_item ON BeltPath(id) WHERE next_item_id IS NOT NULL;
    CREATE INDEX BeltPath_next_gap  ON BeltPath(id) WHERE next_gap_id IS NOT NULL;

    -- A path takes input only when its in-port holds an item; this partial index of
    -- the (few) filled ports lets the tick find those paths without scanning Port.
    CREATE INDEX Port_filled ON Port(id) WHERE item IS NOT NULL;

    CREATE TABLE BeltPathItem (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        path_id INT NOT NULL REFERENCES BeltPath,
        length INT NOT NULL CHECK (length >= 0),

        type INT NOT NULL CHECK (type >= 0)
    );

    -- One index on path_id serves every per-path item lookup (delete/stash/trim/
    -- transfer/sum and the next-gap/next-item MIN scans, which filter type in the
    -- query) plus the BeltPath ON DELETE FK. Keeping it the only non-PK index here
    -- minimises the index maintenance paid on every per-tick item pop/insert.
    CREATE INDEX BeltPathItem_path ON BeltPathItem(path_id);
    -- Items only sit at length 0 transiently (a gap a tick is consuming, about to be
    -- deleted). This partial index lets the tick collect those paths without scanning
    -- every item; it stays tiny because almost no rows match.
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

    -- The paths whose item rows changed during the current tick (an item entered,
    -- popped, or a gap was consumed). The tick's next_gap/next_item recalc reads
    -- this instead of scanning every path; PRIMARY KEY dedups the INSERT OR IGNOREs.
    CREATE TEMPORARY TABLE ChangedPath (
        path_id INTEGER PRIMARY KEY
    );

    -- The paths a tick needs to process at all: rebuilt at the start of each tick
    -- from the partial indexes above so the movement ops touch only live paths
    -- instead of every path in the world. PRIMARY KEY dedups the union inserts.
    CREATE TEMPORARY TABLE ActivePath (
        path_id INTEGER PRIMARY KEY
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
