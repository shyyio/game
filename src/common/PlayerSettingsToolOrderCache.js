export const PLAYER_SETTINGS_TOOL_ORDER_TABLE = "PlayerSettingsToolOrder";

/**
 * Per-player custom toolbar order: hand-authored tool ids, in display order. Never interpreted
 * server-side, only stored and echoed back.
 */
export class PlayerSettingsToolOrderCache {

    constructor() {
        // playerRef -> number[]
        this._byPlayer = new Map();
    }

    /**
     * @param {number} playerRef
     * @param {number[]} toolIds
     * @returns {void}
     */
    setToolOrder(playerRef, toolIds) {
        this._byPlayer.set(playerRef, toolIds);
    }

    /**
     * @param {number} playerRef
     * @returns {number[]}
     */
    getToolOrderByPlayerRef(playerRef) {
        const toolIds = this._byPlayer.get(playerRef);
        if (toolIds === undefined) {
            return [];
        }
        return toolIds;
    }

    /**
     * @returns {object} the PlayerSettingsToolOrder table
     */
    serializeTables() {
        const rows = [];
        for (const [playerRef, toolIds] of this._byPlayer) {
            for (const [position, toolId] of toolIds.entries()) {
                rows.push({playerRef: playerRef, position, toolId: toolId});
            }
        }
        return {
            name: PLAYER_SETTINGS_TOOL_ORDER_TABLE,
            fields: [
                {name: "playerRef", kind: "integer"},
                {name: "position", kind: "integer"},
                {name: "toolId", kind: "integer"},
            ],
            rows,
        };
    }

    /**
     * @param {object|undefined} table - the PlayerSettingsToolOrder table; undefined clears
     * @returns {void}
     */
    deserializeTables(table) {
        this._byPlayer.clear();
        if (table === undefined) {
            return;
        }
        const rowsByPlayer = new Map();
        for (const row of table.rows) {
            let rows = rowsByPlayer.get(row.playerRef);
            if (rows === undefined) {
                rows = [];
                rowsByPlayer.set(row.playerRef, rows);
            }
            rows.push(row);
        }
        for (const [playerRef, rows] of rowsByPlayer) {
            rows.sort((a, b) => a.position - b.position);
            this._byPlayer.set(playerRef, rows.map(row => row.toolId));
        }
    }
}
