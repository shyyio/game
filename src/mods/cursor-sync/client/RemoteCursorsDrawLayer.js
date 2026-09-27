import {
    AbstractDrawLayer,
    Container,
    DisplayPool,
    GAME_FONT,
    Graphics,
    KeyedDisplayPool,
    Text,
    TILE_SIZE,
    Tween,
    claimColor,
    getBlueprintAnchorAt,
    linear,
} from "@spup/sdk/client";
import {CURSOR_SEND_INTERVAL_MS} from "../common/constants.js";

// Classic arrow pointer outline, in screen pixels (the display counter-scales the zoom).
const ARROW_POINTS = [0, 0, 0, 25, 7, 19, 11, 30, 15, 28, 11, 18, 18, 18];
const ARROW_STROKE = 0xffffff;
const ARROW_STROKE_WIDTH = 1.5;

// Username label placement, right of the arrow.
const LABEL_X = 20;
const LABEL_Y = 22;
const LABEL_STROKE = 0xffffff;
const LABEL_STROKE_WIDTH = 3;

// A remote selection's fill, and the claim-colored border every preview takes.
const SELECTION_FILL_ALPHA = 0.12;
const SELECTION_BORDER_WIDTH = 2;
const PASTE_FILL_ALPHA = 0.3;

// Idle displays kept pooled; more concurrent cursors than this is already unusual.
const CURSOR_POOL_CAPACITY = 16;

// A cursor without a heartbeat for this long dims to the idle alpha until it moves again.
const CURSOR_IDLE_MS = 10_000;
const CURSOR_IDLE_ALPHA = 0.6;

/**
 * One remote cursor: a pointer arrow plus the player's username, gliding between heartbeat
 * positions over the send interval.
 */
class RemoteCursorDisplay extends Container {

    constructor() {
        super();
        this._xTween = new Tween(0, CURSOR_SEND_INTERVAL_MS);
        this._yTween = new Tween(0, CURSOR_SEND_INTERVAL_MS);
        this._idleMs = 0;
        this._arrow = new Graphics();
        this._label = new Text({
            text: "",
            style: {
                fontFamily: GAME_FONT,
                fontSize: 15,
                fill: 0x000000,
                stroke: {color: LABEL_STROKE, width: LABEL_STROKE_WIDTH},
            },
        });
        this._label.x = LABEL_X;
        this._label.y = LABEL_Y;
        this.addChild(this._arrow);
        this.addChild(this._label);
    }

    /**
     * Applies a player's identity: their username and stable color.
     * @param {string} username
     * @param {number} color
     * @returns {void}
     */
    show(username, color) {
        this._label.text = username;
        this._label.style.fill = color;
        this._arrow
            .clear()
            .poly(ARROW_POINTS)
            .fill(color)
            .stroke({color: ARROW_STROKE, width: ARROW_STROKE_WIDTH});
    }

    /**
     * Places the cursor with no in-flight glide.
     * @param {number} x world x
     * @param {number} y world y
     * @returns {void}
     */
    snap(x, y) {
        this._xTween.reset(x);
        this._yTween.reset(y);
        this.position.set(x, y);
        this._markActive();
    }

    /**
     * Glides toward a new heartbeat position.
     * @param {number} x world x
     * @param {number} y world y
     * @returns {void}
     */
    retarget(x, y) {
        this._xTween.to(x, linear);
        this._yTween.to(y, linear);
        this._markActive();
    }

    /**
     * Glides the position and dims the cursor once it has idled past {@link CURSOR_IDLE_MS}.
     * @param {number} deltaMS
     * @returns {void}
     */
    advance(deltaMS) {
        this.position.set(this._xTween.advance(deltaMS), this._yTween.advance(deltaMS));
        this._idleMs += deltaMS;
        if (this._idleMs >= CURSOR_IDLE_MS) {
            this.alpha = CURSOR_IDLE_ALPHA;
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _markActive() {
        this._idleMs = 0;
        this.alpha = 1;
    }
}

/**
 * Other players' live cursors with their tool previews, drawn from the remoteCursors state: an
 * open selection spans from its fixed corner to the cursor, a held paste's mask snaps under it.
 * Not chunk-mounted: cursors are few and cross chunks freely. Hidden outside world mode.
 */
export class RemoteCursorsDrawLayer extends AbstractDrawLayer {

    /**
     * @param {Client} client its cache's cursor feed and username lookups, and its tools
     */
    constructor(client) {
        super();
        const state = client.cache;
        this._client = client;
        this._state = state;
        this._players = state.view("players");
        // Under the cursors, which the pool adds after it.
        this._previewGraphics = new Graphics();
        this.addChild(this._previewGraphics);
        // Bumped on every preview write, so the next frame draws it.
        this._previewVersion = 0;
        // What the last preview draw showed; null while nothing is drawn.
        this._drawnPreviewKey = null;
        const pool = new DisplayPool(
            () => {
                const display = new RemoteCursorDisplay();
                this.addChild(display);
                return display;
            },
            display => {
                display.visible = false;
            },
            display => {
                display.visible = true;
            },
            CURSOR_POOL_CAPACITY,
        );
        this._displays = new KeyedDisplayPool(pool);
        state.subscribe("remoteCursors.byPlayer", (playerRef, cursor) => {
            if (cursor === undefined) {
                this._displays.release(playerRef);
            } else {
                this._onUpsert(cursor);
            }
        });
        state.subscribe("remoteCursors.selectionByPlayer", () => {
            this._previewVersion += 1;
        });
        state.subscribe("remoteCursors.pasteByPlayer", () => {
            this._previewVersion += 1;
        });
    }

    get layerIndex() {
        return 50;
    }

    /**
     * @private
     * @param {RemoteCursorState} cursor
     * @returns {void}
     */
    _onUpsert(cursor) {
        const x = cursor.x * TILE_SIZE;
        const y = cursor.y * TILE_SIZE;
        let display = this._displays.get(cursor.playerRef);
        if (display === undefined) {
            display = this._displays.acquire(cursor.playerRef);
            display.show(this._players.getUsernameByPlayerRef(cursor.playerRef), claimColor(cursor.playerRef));
            display.snap(x, y);
        } else {
            display.retarget(x, y);
        }
    }

    /**
     * Glides every cursor and counter-scales the displays to a constant screen size.
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
        for (const display of this._displays.values()) {
            display.advance(deltaMS);
            display.scale.set(invScale);
        }
        this._drawPreviews();
    }

    /**
     * Draws every shown cursor's preview when a preview, a cursor position, or the zoom changed.
     * @private
     * @returns {void}
     */
    _drawPreviews() {
        const selections = Array.from(this._state.mapEntries("remoteCursors.selectionByPlayer"));
        const pastes = Array.from(this._state.mapEntries("remoteCursors.pasteByPlayer"));
        let key = `${this._previewVersion},${this.viewport.scale.x}`;
        for (const [playerRef] of selections.concat(pastes)) {
            const display = this._displays.get(playerRef);
            if (display !== undefined) {
                key += `,${display.x},${display.y}`;
            }
        }
        if (key === this._drawnPreviewKey) {
            return;
        }
        this._drawnPreviewKey = key;
        const graphics = this._previewGraphics;
        graphics.clear();
        for (const [playerRef, selection] of selections) {
            const display = this._displays.get(playerRef);
            if (display === undefined) {
                continue;
            }
            // The tool id comes from another client.
            const tool = this._client.getSelectionToolByIdOrNull(selection.toolId);
            if (tool === null) {
                continue;
            }
            const startX = selection.x * TILE_SIZE;
            const startY = selection.y * TILE_SIZE;
            graphics
                .rect(Math.min(startX, display.x), Math.min(startY, display.y), Math.abs(display.x - startX), Math.abs(display.y - startY))
                .fill({color: tool.marqueeColor, alpha: SELECTION_FILL_ALPHA})
                // A screen-space border, whatever the zoom.
                .stroke({width: SELECTION_BORDER_WIDTH / this.viewport.scale.x, color: claimColor(playerRef)});
        }
        for (const [playerRef, paste] of pastes) {
            const display = this._displays.get(playerRef);
            if (display === undefined) {
                continue;
            }
            const anchor = getBlueprintAnchorAt(display.x / TILE_SIZE, display.y / TILE_SIZE, (paste.tileWidth - 1) / 2, (paste.tileHeight - 1) / 2);
            for (const rowRun of paste.rowRuns) {
                graphics.rect((anchor.x + rowRun.tileX) * TILE_SIZE, (anchor.y + rowRun.tileY) * TILE_SIZE, rowRun.tileLength * TILE_SIZE, TILE_SIZE);
            }
            graphics.fill({color: claimColor(playerRef), alpha: PASTE_FILL_ALPHA});
        }
    }
}
