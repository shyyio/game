
/**
 * The optional client part of a mod: draw layers, tools, and input hooks. Every hook receives the
 * client, giving access to the shared surfaces (cache, itemLayer, session, ...).
 * @abstract
 */
export class AbstractClientMod {

    /**
     * One-time wiring against the shared client surfaces (cache listeners, layer references),
     * called before the mod's draw layers are collected.
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {

    }

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
     * The settings-menu categories this mod contributes; every control key must be a registered
     * client-writable player setting.
     * @param {Client} client
     * @returns {SettingCategory[]}
     */
    settingsCategories(client) {
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
     * Optional hook: the zoom-driven view mode changed (draw layers get it separately).
     * @param {ViewMode} mode
     * @param {Client} client
     * @returns {void}
     */
    setViewMode(mode, client) {

    }

    /**
     * Optional hook: the client finished init (textures loaded, layers mounted, session live);
     * the place to start timers.
     * @param {Client} client
     * @returns {void}
     */
    onReady(client) {

    }

    /**
     * Client-side mirror of a sim placement rule the derived ObjectTool cannot know (a pipe
     * bridging fluid types); false marks the whole placement blocked in the feedback.
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {Client} client
     * @returns {boolean}
     */
    canPlace(type, tileX, tileY, direction, client) {
        return true;
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
