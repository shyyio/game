
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
        const defs = this.mods.reduce((acc, mod) => Object.assign(acc, mod.definitions), {});

        // Assign each definition a stable numeric typeId by registration order — the wire's object
        // type discriminator and the client cache's identity. Same positional contract as wire ids.
        Object.values(defs).forEach((definition, typeId) => {
            definition.typeId = typeId;
        });

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
     * Routes an inspect hover to every mod and drives the inspect-highlight layer with the
     * highlights they return (empty clears it).
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {Client} client
     */
    handleInspect(tileX, tileY, client) {
        const highlights = this.mods
            .flatMap(mod => mod.onInspect(tileX, tileY, client));
        client.inspectLayer.show(highlights);
    }

    /**
     * Gathers every mod's individual sync events for a newly-visible chunk.
     * @param {string} chunk
     * @returns {AbstractEvent[]}
     */
    chunkSyncEvents(chunk) {
        return this.mods
            .flatMap(mod => mod.chunkSyncEvents(chunk));
    }

    /**
     * @returns {Array}
     */
    get drawLayers() {
        return this.mods
            .filter(mod => mod.drawLayers != null)
            .flatMap(mod => mod.drawLayers);
    }

    /**
     * Item type -> texture name, merged across all mods, for the shared item layer.
     * @returns {Object.<number, string>}
     */
    get itemTextures() {
        return this.mods
            .reduce((textures, mod) => Object.assign(textures, mod.itemTextures), {});
    }

    /**
     * Aggregates mini menu entries from all mods for the tile at (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @param {AbstractSession} session
     * @param {Client} client
     * @returns {MiniMenuEntry[]}
     */
    miniMenuEntries(tileX, tileY, session, client) {
        return this.mods
            .flatMap(mod => mod.miniMenuEntries(tileX, tileY, session, client))
            .sort((a, b) => b.rank - a.rank);
    }

    /**
     * Gathers the tools every mod makes available.
     * @param {Client} client
     * @returns {AbstractTool[]}
     */
    tools(client) {
        return this.mods
            .flatMap(mod => mod.tools(client));
    }
}