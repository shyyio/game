import {SqlStatement} from "@/common/core.js";
import {CHUNK_SIZE, GameSettingsKey} from "@/common/constants.js";

// The simulation runs entirely on the bitECS engine; SQLite is kept only for session/settings infra
// (and, later, persistence). No sim tables, tick pipeline, port graph, or per-object statements.
const CoreStatements = [
    new SqlStatement("End", "END TRANSACTION"),
    new SqlStatement("Begin", "BEGIN TRANSACTION;"),
    new SqlStatement("Rollback", "ROLLBACK TRANSACTION;"),

    new SqlStatement("InsertSession", "INSERT INTO Session (player_id) VALUES (@player_id) RETURNING id;"),
    new SqlStatement("GetPlayerSettings", `SELECT key, value FROM PlayerSettings WHERE player_id = @player_id;`),
    new SqlStatement("GetGameSettings", `SELECT key, value FROM GameSettings;`),
];

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
`;

const CoreTempSchema = `
    INSERT INTO GameSettings (key, value) VALUES
        (${GameSettingsKey.CHUNK_SIZE}, ${CHUNK_SIZE})
        ON CONFLICT DO UPDATE SET value=${CHUNK_SIZE};

    CREATE TEMPORARY TABLE Session (
        id INTEGER PRIMARY KEY,
        player_id INT NOT NULL
    );
`;

const CorePragma = `
    PRAGMA foreign_keys=1;
    PRAGMA ignore_check_constraints=0;
    PRAGMA journal_mode=off;
    PRAGMA temp_store=memory;
    PRAGMA optimize=0x10002;
`;

export class DatabaseSchema {

    constructor(modRegistry) {
        this.modRegistry = modRegistry;

        this.preparedStatements = {};
        // No SQL tick pipeline — Game ticks the bitECS engine. Kept empty for callers that read it.
        this.tickPhases = {};

        this.initSchema = [CoreSchema];
        this.tempSchema = [CoreTempSchema];
        this.pragma = [CorePragma];

        CoreStatements.forEach(statement => {
            this._prepare(statement.statementName, statement.sql);
        });

        // Assign each ObjectDefinition its typeId (registration order), which the bitECS engine uses.
        this.modRegistry.definitions;
    }

    _prepare(name, statement) {
        if (name === undefined) {
            throw new Error(`Cannot prepare statement with no name: ${statement}`);
        }
        this.preparedStatements[name] = statement;
    }
}
