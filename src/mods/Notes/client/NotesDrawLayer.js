import {
    AbstractDrawLayer,
    DisplayPool,
    KeyedDisplayPool,
    OVERWRITE_TILE_COLOR,
    claimColor,
    tileId,
} from "@spup/sdk/client";
import {NotePin} from "./NotePin.js";
import {noteAnchor} from "./layout.js";

// Idle pins kept pooled; a screenful of notes past this is already unusual.
const PIN_POOL_CAPACITY = 32;

// The ring around the marker the pointer is on, in the inspect highlight art's own two greens.
const HIGHLIGHT_COLOR = 0xc8f902;
const HIGHLIGHT_OUTLINE_COLOR = 0xa2c600;

// The ring the note tool gets instead: a note already standing there is what the tap lands on,
// which is the engine's overwrite feedback, darkened for the outline.
const OVERWRITE_OUTLINE_COLOR = 0x1f629d;

// Resting this long over a marker opens its tooltip; a sweep past it opens nothing.
const HOVER_DELAY_MS = 350;

/**
 * The notes of the subscribed chunks, drawn from the notes state. Not chunk-mounted: notes are few
 * and each is a single marker. Each pin is interactive: the pointer over it takes the pointer
 * cursor and, after a short delay, opens the note's tooltip. Stays visible in map mode, where pins
 * snap to tile centers.
 */
export class NotesDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ClientCache} state the note feed and the hover target it drives
     */
    constructor(state) {
        super();
        // The layer itself is not hit-tested, its pins are.
        this.eventMode = "passive";
        this._state = state;
        this._notes = state.writer("notes");
        this._mapMode = false;
        // The pin under the pointer, and the tile the note tool hovers; either rings its pin.
        this._pointerTile = null;
        this._toolTile = null;
        // The tile currently ringed, so a change touches two pins instead of every one.
        this._highlightedTile = null;
        this._hoverTimer = null;
        const pool = new DisplayPool(
            () => this._buildPin(),
            pin => {
                pin.visible = false;
                pin.setHighlight(null);
                pin.tile = null;
            },
            pin => {
                pin.visible = true;
            },
            PIN_POOL_CAPACITY,
        );
        this._pins = new KeyedDisplayPool(pool);
        state.subscribe("notes.byTile", (tile, note) => {
            if (note === undefined) {
                if (this._pointerTile === tile) {
                    this._pointerTile = null;
                    this._clearHoverTimer();
                }
                if (this._highlightedTile === tile) {
                    this._highlightedTile = null;
                }
                this._pins.release(tile);
                this._applyHighlight();
            } else {
                this._onUpsert(tile, note);
            }
        });
    }

    get layerIndex() {
        return 55;
    }

    /**
     * Map mode keeps the pins, snapped to their tile centers, and keeps them hoverable — only the
     * click cursor goes, since a tap up there selects chunks instead of opening a note.
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
        for (const [tile, note] of this._state.mapEntries("notes.byTile")) {
            const pin = this._pins.get(tile);
            this._place(pin, note);
            this._applyPointerMode(pin);
        }
    }

    /**
     * The tile the note tool hovers (null while it hovers none): its note, if any, rings like a
     * pointed-at pin, since tapping the tile opens it instead of placing.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {void}
     */
    setToolTile(tileX, tileY) {
        if (tileX === null) {
            this._toolTile = null;
        } else {
            this._toolTile = tileId(tileX, tileY);
        }
        this._applyHighlight();
    }

    /**
     * The note whose marker the pointer sits on, null for anywhere else — a tap claims a note only
     * through this, so an object sharing the tile keeps the rest of it. The pointer's pin is what
     * pixi hit-tested against the pin's own hitArea, so no second hit test is needed.
     * @returns {Note|null}
     */
    noteAtPointer() {
        if (this._pointerTile === null) {
            return null;
        }
        const note = this._state.mapGet("notes.byTile", this._pointerTile);
        if (note === undefined) {
            return null;
        }
        return note;
    }

    /**
     * @private
     * @returns {NotePin}
     */
    _buildPin() {
        const pin = new NotePin();
        this._applyPointerMode(pin);
        pin.on("pointerover", () => this._onPointerOver(pin));
        pin.on("pointerout", () => this._onPointerOut(pin));
        this.addChild(pin);
        return pin;
    }

    /**
     * @private
     * @param {NotePin} pin
     * @returns {void}
     */
    _applyPointerMode(pin) {
        pin.eventMode = "static";
        if (this._mapMode) {
            pin.cursor = "default";
        } else {
            pin.cursor = "pointer";
        }
    }

    /**
     * @private
     * @param {NotePin} pin
     * @returns {void}
     */
    _onPointerOver(pin) {
        const tile = pin.tile;
        if (tile === null) {
            return;
        }
        this._pointerTile = tile;
        this._applyHighlight();
        this._clearHoverTimer();
        // A tooltip is for resting on a marker, not for sweeping past one.
        this._hoverTimer = setTimeout(() => {
            this._hoverTimer = null;
            const note = this._state.mapGet("notes.byTile", tile);
            if (note !== undefined && this._pointerTile === tile) {
                this._notes.setHover(note);
            }
        }, HOVER_DELAY_MS);
    }

    /**
     * @private
     * @param {NotePin} pin
     * @returns {void}
     */
    _onPointerOut(pin) {
        if (this._pointerTile !== pin.tile) {
            return;
        }
        this._pointerTile = null;
        this._applyHighlight();
        this._clearHoverTimer();
        this._notes.setHover(null);
    }

    /**
     * @private
     * @returns {void}
     */
    _clearHoverTimer() {
        if (this._hoverTimer !== null) {
            clearTimeout(this._hoverTimer);
            this._hoverTimer = null;
        }
    }

    /**
     * Rings the pin the pointer or the note tool is over, and only that one.
     * @private
     * @returns {void}
     */
    _applyHighlight() {
        let highlighted = this._pointerTile;
        let color = HIGHLIGHT_COLOR;
        let outlineColor = HIGHLIGHT_OUTLINE_COLOR;
        if (highlighted === null) {
            highlighted = this._toolTile;
            color = OVERWRITE_TILE_COLOR;
            outlineColor = OVERWRITE_OUTLINE_COLOR;
        }
        if (highlighted === this._highlightedTile) {
            return;
        }
        const cleared = this._pins.get(this._highlightedTile);
        if (cleared !== undefined) {
            cleared.setHighlight(null);
        }
        this._highlightedTile = highlighted;
        const ringed = this._pins.get(highlighted);
        if (ringed !== undefined) {
            ringed.setHighlight(color, outlineColor);
        }
    }

    /**
     * @private
     * @param {number} tile
     * @param {Note} note
     * @returns {void}
     */
    _onUpsert(tile, note) {
        const pin = this._pins.take(tile);
        pin.tile = tile;
        pin.show(claimColor(note.authorId));
        this._place(pin, note);
        this._applyPointerMode(pin);
        // A fresh pin lands unringed, so only its own tile's highlight has to be restored.
        if (tile === this._highlightedTile) {
            this._highlightedTile = null;
            this._applyHighlight();
        }
    }

    /**
     * @private
     * @param {NotePin} pin
     * @param {Note} note
     * @returns {void}
     */
    _place(pin, note) {
        const anchor = noteAnchor(note, this._mapMode);
        pin.position.set(anchor.x, anchor.y);
    }

    /**
     * Counter-scales the pins to a constant screen size.
     * @param {number} frame
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        if (!this.visible) {
            return;
        }
        const invScale = 1 / this.viewport.scale.x;
        for (const pin of this._pins.values()) {
            pin.scale.set(invScale);
        }
    }
}
