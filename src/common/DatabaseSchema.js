import {SqlStatement} from "@/common/core.js";

// The simulation runs entirely on the bitECS engine; sessions and settings live in JS collections on
// Game. SQLite is kept only for transaction control (and, later, persistence).
const CoreStatements = [
    new SqlStatement("End", "END TRANSACTION"),
    new SqlStatement("Begin", "BEGIN TRANSACTION;"),
    new SqlStatement("Rollback", "ROLLBACK TRANSACTION;"),
];

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
