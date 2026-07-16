
/**
 * The optional client part of a mod: draw layers, tools, and input hooks. Every hook receives the
 * client, giving access to the shared surfaces (cache, itemLayer, session, ...).
 */
export class AbstractClientMod {

    /**
     * The draw layers this mod contributes, bound to the shared client surfaces.
     * @param {Client} client
     * @returns {AbstractDrawLayer[]}
     */
    drawLayers(client) {
        return [];
    }

    /**
     * The tools this mod makes available, bound to the shared client surfaces.
     * @param {Client} client
     * @returns {AbstractTool[]}
     */
    tools(client) {
        return [];
    }

    /**
     * Handles a client-delivered event, updating the mod's own state and draw layers.
     * @param {AbstractEvent} event
     * @param {Client} client
     * @returns {void}
     */
    onEvent(event, client) {

    }

    /**
     * Inspect hook (null coords = cleared); returns the objects to highlight and may update the
     * mod's own draw layers.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {Client} client
     * @returns {InspectHighlight[]}
     */
    onInspect(tileX, tileY, client) {
        return [];
    }

    /**
     * Returns mini-menu entries (each with its own handler) for the tile at (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @param {AbstractSession} session
     * @param {Client} client
     * @returns {MiniMenuEntry[]}
     */
    miniMenuEntries(tileX, tileY, session, client) {
        return [];
    }
}
