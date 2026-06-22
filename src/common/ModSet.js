
export class ModSet {

    constructor() {
        /**
         * @type {Mod[]}
         */
        this.mods = [];
    }

    /**
     * @param {Mod} mod
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
     * Message/event classes contributed by all mods, in load order.
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
     * @param {Message} message
     */
    dispatchMessage(message) {
        this.mods.forEach(mod => {
            mod.onMessage(message);
        });
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
     * Aggregates mini menu entries from all mods for the tile at (x, y).
     * @param {number} x - tile x
     * @param {number} y - tile y
     * @param {Session} session
     * @returns {MiniMenuEntry[]}
     */
    miniMenuContextEntries(x, y, session) {
        const entries = [];
        this.mods.forEach(mod => {
            const modEntries = mod.miniMenuContextEntries(x, y, session);
            if (modEntries == null) {
                return;
            }
            modEntries.forEach(entry => entries.push(entry));
        });
        entries.sort((a, b) => b.rank - a.rank);
        return entries;
    }

    /**
     * @param {Session} session
     * @param {PlayerSettings} playerSettings
     * @returns {Tool[]}
     */
    getTools(session, playerSettings) {
        const tools = [];
        this.mods.forEach(mod => {
            const modTools = mod.getTools(session, playerSettings);
            if (modTools == null) {
                return;
            }
            modTools.forEach(tool => tools.push(tool));
        });
        return tools;
    }
}