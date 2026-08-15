import {AbstractClientMod, ViewMode} from "@spup/sdk/client";
import {notesTextureAtlases} from "./assets.js";
import {NOTES_SCHEMA, NotesWriter} from "./client/NotesState.js";
import {NotesDrawLayer} from "./client/NotesDrawLayer.js";
import {NoteGhostLayer} from "./client/NoteGhostLayer.js";
import {NotePanelLayer} from "./client/NotePanelLayer.js";
import {NoteTooltipLayer} from "./client/NoteTooltipLayer.js";
import {NoteTool} from "./client/NoteTool.js";

/**
 * The Notes mod's client part: the "notes" cache namespace, the world pins and their placement
 * ghost, the note tool, the editor panel, and the hover tooltip. The pins answer the pointer
 * themselves (cursor, tooltip); a tool-less tap on their tile opens the editor.
 */
export class NotesClientMod extends AbstractClientMod {

    constructor() {
        super();
        this._writer = null;
        this._layer = null;
        this._ghostLayer = null;
        this._panelLayer = null;
        this._tooltipLayer = null;
        this._tool = null;
    }

    /**
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {
        client.cache.register("notes", NOTES_SCHEMA, new NotesWriter(client.cache));
        this._writer = client.cache.writer("notes");
        this._layer = new NotesDrawLayer(client.cache);
        this._ghostLayer = new NoteGhostLayer(client.cache);
        this._panelLayer = new NotePanelLayer(client.app, client.cache, client.session);
        this._tooltipLayer = new NoteTooltipLayer(client.app, client.cache);
        this._tool = new NoteTool(client, this._layer, this._ghostLayer);
    }

    /**
     * @returns {TextureAtlas[]}
     */
    textureAtlases() {
        return notesTextureAtlases;
    }

    /**
     * @param {Client} client
     * @returns {AbstractDrawLayer[]}
     */
    drawLayers(client) {
        return [this._layer, this._ghostLayer];
    }

    /**
     * @param {Client} client
     * @returns {Container[]}
     */
    hudLayers(client) {
        return [this._panelLayer, this._tooltipLayer];
    }

    /**
     * @param {Client} client
     * @returns {AbstractTool[]}
     */
    tools(client) {
        return [this._tool];
    }

    /**
     * A tap with no tool selected opens the marker under the pointer; anywhere else on the tile
     * belongs to whatever is placed there.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Client} client
     * @returns {boolean}
     */
    onObjectTap(tileX, tileY, client) {
        const note = this._layer.noteAtPointer();
        if (note === null) {
            return false;
        }
        // The tap is spent on the marker either way: a note the player may not touch still
        // answers with a notice rather than falling through to whatever it stands on.
        this._tool.openAt(note.tileX, note.tileY);
        return true;
    }

    /**
     * The editor is world-only; the tooltip survives into map mode, where the pins do too, and
     * goes with them in the overworld.
     * @param {ViewMode} mode
     * @param {Client} client
     * @returns {void}
     */
    setViewMode(mode, client) {
        this._tooltipLayer.setMapMode(mode === ViewMode.MAP);
        if (mode === ViewMode.WORLD) {
            return;
        }
        this._writer.closeEditor();
        if (mode === ViewMode.OVERWORLD) {
            this._writer.setHover(null);
        }
    }
}
