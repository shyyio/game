
export class ModRegistry {

    constructor() {
        /**
         * @type {AbstractMod[]}
         */
        this.mods = [];
    }

    /**
     * @param {AbstractMod} mod
     */
    loadMod(mod) {
        this.mods.push(mod);
    }

    /**
     * @returns {string}
     */
    get initSchema() {
        return this.mods.map(mod => mod.schema).join("\n");
    }

    /**
     * @returns {string}
     */
    get tempSchema() {
        return this.mods.map(mod => mod.tempSchema).join("\n");
    }

    /**
     * @returns {Object.<string, ObjectDefinition>}
     */
    get definitions() {
        const defs = {};

        this.mods.forEach(mod => Object.assign(defs, mod.definitions));

        return defs;
    }

    /**
     * AbstractMessage/event classes contributed by all mods, in load order.
     * @returns {Function[]}
     */
    get wireClasses() {
        const classes = [];
        this.mods.forEach(mod => {
            mod.wireClasses.forEach(cls => classes.push(cls));
        });
        return classes;
    }

    /**
     * @param {AbstractMessage} message
     */
    dispatchMessage(message) {
        this.mods.forEach(mod => {
            mod.onMessage(message);
        });
    }

    /**
     * Routes a client-delivered event to every mod's client-side handler.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    handleClientEvent(event, client) {
        this.mods.forEach(mod => {
            mod.onClientEvent(event, client);
        });
    }

    /**
     * Routes an inspect hover to every mod and drives the inspect-highlight layer with
     * the tiles they return (empty clears it).
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {Client} client
     */
    handleInspect(tileX, tileY, client) {
        const tiles = [];
        this.mods.forEach(mod => {
            const modTiles = mod.onInspect(tileX, tileY);
            if (modTiles == null) {
                return;
            }
            modTiles.forEach(tile => tiles.push(tile));
        });
        client.inspectLayer.show(tiles);
    }

    /**
     * Gathers every mod's individual sync events for a newly-visible chunk.
     * @param {string} chunk
     * @returns {AbstractEvent[]}
     */
    collectChunkSync(chunk) {
        const events = [];
        this.mods.forEach(mod => {
            const modEvents = mod.collectChunkSync(chunk);
            modEvents.forEach(event => events.push(event));
        });
        return events;
    }

    /**
     * @returns {Array}
     */
    get drawLayers() {
        const result = [];
        this.mods.forEach(mod => {
            if (mod.drawLayers == null) {
                return;
            }
            mod.drawLayers.forEach(layer => {
                result.push(layer);
            });
        });
        return result;
    }

    /**
     * Aggregates mini menu entries from all mods for the tile at (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @param {AbstractSession} session
     * @returns {MiniMenuEntry[]}
     */
    miniMenuContextEntries(tileX, tileY, session) {
        const entries = [];
        this.mods.forEach(mod => {
            const modEntries = mod.miniMenuContextEntries(tileX, tileY, session);
            if (modEntries == null) {
                return;
            }
            modEntries.forEach(entry => entries.push(entry));
        });
        entries.sort((a, b) => b.rank - a.rank);
        return entries;
    }

    /**
     * Gathers the tools every mod makes available.
     * @param {Client} client
     * @returns {AbstractTool[]}
     */
    tools(client) {
        const tools = [];
        this.mods.forEach(mod => {
            const modTools = mod.tools(client);
            if (modTools == null) {
                return;
            }
            modTools.forEach(tool => tools.push(tool));
        });
        return tools;
    }
}