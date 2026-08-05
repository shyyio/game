export const PLAYER_SETTINGS_TOOL_ORDER_RECORD = "PlayerSettingsToolOrder";

/**
 * Per-player custom toolbar order: hand-authored tool ids, in display order. Never interpreted
 * server-side, only stored and echoed back.
 */
export class PlayerSettingsToolOrderCache {

    constructor() {
        // playerId -> number[]
        this._byPlayer = new Map();
    }

    /**
     * @param {number} playerId
     * @param {number[]} toolIds
     * @returns {void}
     */
    set(playerId, toolIds) {
        this._byPlayer.set(playerId, toolIds);
    }

    /**
     * @param {number} playerId
     * @returns {number[]}
     */
    get(playerId) {
        const toolIds = this._byPlayer.get(playerId);
        if (toolIds === undefined) {
            return [];
        }
        return toolIds;
    }

    /**
     * @returns {object} the PlayerSettingsToolOrder record table
     */
    serializeRecords() {
        const rows = [];
        for (const [playerId, toolIds] of this._byPlayer) {
            for (const [position, toolId] of toolIds.entries()) {
                rows.push({player_id: playerId, position, tool_id: toolId});
            }
        }
        return {
            name: PLAYER_SETTINGS_TOOL_ORDER_RECORD,
            fields: [
                {name: "player_id", kind: "integer"},
                {name: "position", kind: "integer"},
                {name: "tool_id", kind: "integer"},
            ],
            rows,
        };
    }

    /**
     * @param {object|undefined} table - the PlayerSettingsToolOrder record table; undefined clears
     * @returns {void}
     */
    deserializeRecords(table) {
        this._byPlayer.clear();
        if (table === undefined) {
            return;
        }
        const rowsByPlayer = new Map();
        for (const row of table.rows) {
            let rows = rowsByPlayer.get(row.player_id);
            if (rows === undefined) {
                rows = [];
                rowsByPlayer.set(row.player_id, rows);
            }
            rows.push(row);
        }
        for (const [playerId, rows] of rowsByPlayer) {
            rows.sort((a, b) => a.position - b.position);
            this._byPlayer.set(playerId, rows.map(row => row.tool_id));
        }
    }
}
