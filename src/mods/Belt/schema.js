import {CHUNK_KEY_SQL} from "@/sdk/common.js";
import {
    BELT_UNDERGROUND,
    ITEM_TYPE_GAP,
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

    CREATE TEMPORARY TABLE BeltPathOutputItem (
        path_id INTEGER PRIMARY KEY,
        port_id INT NOT NULL,
        item_id INT NOT NULL,
        item_type INT NOT NULL
    );

    INSERT INTO GameSettings (key, value) VALUES
        (${BeltGameSettingsKey.MAX_UNDERGROUND_LENGTH}, ${MAX_UNDERGROUND_LENGTH});
`;
