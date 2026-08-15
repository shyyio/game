import {
    AbstractDrawLayer,
    GHOST_BLOCKED_ALPHA,
    GHOST_BLOCKED_TINT,
    Mouse,
    claimColor,
    tileId,
} from "@spup/sdk/client";
import {NOTE_EDITOR_MODE_PLACE} from "./NotesState.js";
import {NotePin} from "./NotePin.js";
import {noteAnchor} from "./layout.js";

const GHOST_ALPHA = 0.55;

/**
 * Where the next note's marker will land: a translucent pin under the pointer while the note tool
 * is active, parked on the pending anchor while the editor writes it.
 */
export class NoteGhostLayer extends AbstractDrawLayer {

    /**
     * @param {ClientCache} state the pending editor target and the own player's identity
     */
    constructor(state) {
        super();
        this._state = state;
        this._claims = state.view("chunkClaims");
        this._active = false;
        // The tile the tool hovers; a note already standing there takes the ghost's place.
        this._hoveredTile = null;
        // Whether that tile refuses a note (unclaimed, or someone else's).
        this._blocked = false;
        // The color the pin currently carries; the own identity only arrives with the welcome
        // event, after this layer is built.
        this._paintedColor = null;
        this._pin = new NotePin();
        this.addChild(this._pin);
    }

    get layerIndex() {
        return 56;
    }

    /**
     * The note tool became (or stopped being) the active tool.
     * @param {boolean} value
     * @returns {void}
     */
    setActive(value) {
        this._active = value;
    }

    /**
     * The tile the note tool hovers, null while it hovers none.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {boolean} blocked whether a note may not be left there
     * @returns {void}
     */
    setHoveredTile(tileX, tileY, blocked) {
        if (tileX === null) {
            this._hoveredTile = null;
        } else {
            this._hoveredTile = tileId(tileX, tileY);
        }
        this._blocked = blocked;
    }

    /**
     * Follows the pointer, or the anchor of the note being written.
     * @param {number} frame
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        const anchor = this._anchor();
        this._pin.visible = anchor !== null;
        if (anchor === null) {
            return;
        }
        this._paint();
        this._pin.position.set(anchor.x, anchor.y);
        this._pin.scale.set(1 / this.viewport.scale.x);
    }

    /**
     * Paints the ghost in the own player's color, or red where the tile refuses a note.
     * @private
     * @returns {void}
     */
    _paint() {
        let color = claimColor(this._claims.ownPlayerId);
        let alpha = GHOST_ALPHA;
        if (this._blocked) {
            color = GHOST_BLOCKED_TINT;
            alpha = GHOST_BLOCKED_ALPHA;
        }
        if (color === this._paintedColor) {
            return;
        }
        this._paintedColor = color;
        this._pin.alpha = alpha;
        this._pin.show(color);
    }

    /**
     * @private
     * @returns {{x: number, y: number}|null} the ghost's world position, null while it has none
     */
    _anchor() {
        const target = this._state.get("notes.editorTarget");
        if (target !== null) {
            if (target.mode !== NOTE_EDITOR_MODE_PLACE) {
                return null;
            }
            return noteAnchor(target);
        }
        const aim = Mouse.aimPoint();
        if (!this._active || aim === null) {
            return null;
        }
        // A tap on an occupied tile opens its note instead of placing one, so no ghost promises it.
        if (this._hoveredTile !== null && this._state.mapGet("notes.byTile", this._hoveredTile) !== undefined) {
            return null;
        }
        return aim;
    }
}
