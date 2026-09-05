import {AbstractTool, Mouse, PLAYER_ID_NONE, TILE_SIZE, tileId} from "@spup/sdk/client";
import {NOTE_OFFSET_CENTER, NOTE_OFFSET_UNITS, NOTE_TOOL_ID} from "../common/constants.js";
import {NOTE_EDITOR_MODE_PLACE, NOTE_EDITOR_MODE_EDIT, NOTE_EDITOR_MODE_DELETE, NoteEditorTarget} from "./NotesState.js";

/**
 * Places a note where the player taps, or reopens the note standing there. Nothing is sent until
 * the editor panel saves. Dragging pans the map instead of painting. The anchor is the aim point,
 * so a note sits anywhere on its tile — under mobile's center-lock that is the crosshair, which a
 * finger cannot cover.
 */
export class NoteTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {NotesDrawLayer} notesLayer
     * @param {NoteGhostLayer} ghostLayer
     */
    constructor(
        client,
        notesLayer,
        ghostLayer,
    ) {
        super(client.session);
        this._client = client;
        this._cache = client.cache;
        // Only for the own player's identity; the build gate goes through the client.
        this._claims = client.cache.view("chunkClaims");
        this._notes = client.cache.writer("notes");
        this._notesLayer = notesLayer;
        this._ghostLayer = ghostLayer;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
    }

    get label() {
        return "Note";
    }

    get id() {
        return NOTE_TOOL_ID;
    }

    get textureName() {
        return "ui/note";
    }

    get statusText() {
        return "Note: tap a tile to leave one";
    }

    /**
     * @returns {boolean}
     */
    get paintsOnDrag() {
        return false;
    }

    /**
     * @returns {void}
     */
    onActivate() {
        this._ghostLayer.setActive(true);
    }

    /**
     * @returns {void}
     */
    onDeactivate() {
        this._ghostLayer.setActive(false);
        this._setHoveredTile(null, null);
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    onTileEnter(tileX, tileY) {
        this._setHoveredTile(tileX, tileY);
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    onTileExit(tileX, tileY) {
        this._setHoveredTile(null, null);
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    onTap(tileX, tileY) {
        this.openAt(tileX, tileY);
    }

    /**
     * Notes are placed one tap at a time; a drag pans instead (see paintsOnDrag).
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {void}
     */
    onDragTile(tileX, tileY, direction) {}

    /**
     * Opens the editor for the tile: the note standing there, or a fresh one anchored at the
     * pointer. Also the tool-less (inspect) tap path.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    openAt(tileX, tileY) {
        const note = this._cache.mapGet("notes.byTile", tileId(tileX, tileY));
        if (note !== undefined) {
            this._openExisting(note);
            return;
        }
        if (!this._client.canBuildAt(tileX, tileY)) {
            this._client.hud.notify("You cannot leave a note here");
            return;
        }
        const aim = Mouse.aimPoint();
        let aimX = null;
        let aimY = null;
        if (aim !== null) {
            aimX = aim.x;
            aimY = aim.y;
        }
        this._notes.openEditor(new NoteEditorTarget(
            tileX,
            tileY,
            this._anchorOffset(aimX, tileX),
            this._anchorOffset(aimY, tileY),
            "",
            NOTE_EDITOR_MODE_PLACE,
            PLAYER_ID_NONE,
        ));
    }

    /**
     * Opens someone's note: the author edits it, a build-rights holder may only remove it.
     * @private
     * @param {Note} note
     * @returns {void}
     */
    _openExisting(note) {
        let mode = NOTE_EDITOR_MODE_EDIT;
        if (note.authorId !== this._claims.ownPlayerId) {
            if (!this._client.canBuildAt(note.tileX, note.tileY)) {
                this._client.hud.notify("That note belongs to someone else");
                return;
            }
            mode = NOTE_EDITOR_MODE_DELETE;
        }
        this._notes.openEditor(new NoteEditorTarget(
            note.tileX,
            note.tileY,
            note.offsetMx,
            note.offsetMy,
            note.text,
            mode,
            note.authorId,
        ));
    }

    /**
     * Points the placement feedback at a tile: a note already there rings and the ghost steps
     * aside, a chunk the player may not build in marks the tile (and the ghost) blocked.
     * @private
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {void}
     */
    _setHoveredTile(tileX, tileY) {
        const blocked = tileX !== null && !this._client.canBuildAt(tileX, tileY);
        this._notesLayer.setToolTile(tileX, tileY);
        this._ghostLayer.setHoveredTile(tileX, tileY, blocked);
        // Only the rejection is drawn on the tile: the ghost already shows where the note lands.
        if (!blocked) {
            this._placementFeedbackLayer.clear();
            return;
        }
        this._placementFeedbackLayer.show({blocked: [{x: tileX, y: tileY}]});
    }

    /**
     * The aim point's sub-tile offset in milli-tiles, falling back to the tile center where it
     * sits elsewhere (a tap the pointer never tracked).
     * @private
     * @param {number|null} coordinate world pixel coordinate
     * @param {number} tile the tapped tile along the same axis
     * @returns {number}
     */
    _anchorOffset(coordinate, tile) {
        if (coordinate === null) {
            return NOTE_OFFSET_CENTER;
        }
        const offset = Math.floor((coordinate / TILE_SIZE - tile) * NOTE_OFFSET_UNITS);
        if (offset < 0 || offset >= NOTE_OFFSET_UNITS) {
            return NOTE_OFFSET_CENTER;
        }
        return offset;
    }
}
