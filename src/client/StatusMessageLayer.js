import {Container, Graphics, Text} from "pixi.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_FILL, PANEL_FILL_ALPHA, PANEL_BORDER, PANEL_TEXT} from "@/client/Theme.js";

// Screen-pixel inset of the panel from the top-left corner.
const MARGIN = 12;
const PADDING_X = 12;
const PADDING_Y = 8;

// Loading counts can change several times a frame while syncs drain, and every Text write
// re-rasterizes its canvas; message writes coalesce to one per interval.
const TEXT_REFRESH_MS = 100;

/**
 * Static top-left status overlay: a screen-space HUD sibling of the viewport (on app.stage),
 * not a viewport child, so it never pans or zooms. Shows "Connecting…" until the client
 * issues its first viewport request, then "Loading... x / y" while the requested chunks are
 * subscribing, where x is the number of ChunkSubscribeEvents processed out of the total.
 */
export class StatusMessageLayer extends Container {

    constructor() {
        super();
        this.zIndex = 10000;
        this.visible = false;
        this._connecting = false;
        // Chunks already subscribed, so a re-issued viewport request only counts new ones.
        this._subscribed = new Set();
        // Chunks in the active load; total = _batch.size, loaded = _batch.size - _pending.size.
        // A chunk that pans out of view is unsubscribed and drops from the batch, so the
        // total tracks only currently-relevant chunks instead of growing while panning.
        this._batch = new Set();
        // Batch chunks still awaiting a ChunkSubscribeEvent.
        this._pending = new Set();
        // Message-write coalescing: the timer gating the next Text write, and the message to
        // apply when it fires.
        this._textTimer = null;
        this._pendingMessage = null;

        this._panel = new Container();
        this._panel.x = MARGIN;
        this._panel.y = MARGIN;
        this._background = new Graphics();
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TEXT},
        });
        this._text.x = PADDING_X;
        this._text.y = PADDING_Y;
        this._panel.addChild(this._background);
        this._panel.addChild(this._text);
        this.addChild(this._panel);
    }

    /**
     * Shows the connecting message, until the first chunk load begins.
     * @returns {void}
     */
    setConnecting() {
        this._connecting = true;
        this._refresh();
    }

    /**
     * Begins tracking a viewport request: the not-yet-subscribed chunks become the
     * loading total, cleared as their ChunkSubscribeEvents arrive. Any "Connecting…"
     * message holds until the first of those chunks actually arrives.
     * @param {string[]} chunks all chunks in the request
     * @returns {void}
     */
    beginChunkLoad(chunks) {
        // A fresh load once the previous one drained; otherwise extend the running one.
        if (this._pending.size === 0) {
            this._batch.clear();
        }
        for (const chunk of chunks) {
            if (!this._subscribed.has(chunk) && !this._pending.has(chunk)) {
                this._pending.add(chunk);
                this._batch.add(chunk);
            }
        }
        this._refresh();
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof ChunkSubscribeEvent) {
            this._subscribed.add(event.chunk);
            if (this._pending.delete(event.chunk)) {
                // The first arriving chunk ends the connecting phase.
                this._connecting = false;
                this._refresh();
            }
        } else if (event instanceof ChunkUnsubscribeEvent) {
            this._subscribed.delete(event.chunk);
            // A chunk that left the viewport drops out of the load: it leaves the total,
            // and if its subscribe hadn't arrived yet, the pending count too — so the
            // loader tracks only currently-relevant chunks and always reaches completion.
            if (this._batch.delete(event.chunk)) {
                this._pending.delete(event.chunk);
                this._refresh();
            }
        }
    }

    /**
     * Updates the message and visibility from the current state.
     * @private
     * @returns {void}
     */
    _refresh() {
        if (this._connecting) {
            this._show("Connecting…");
        } else if (this._pending.size > 0) {
            this._show(`Loading... ${this._batch.size - this._pending.size} / ${this._batch.size}`);
        } else {
            this.visible = false;
        }
    }

    /**
     * Shows a message, coalescing rapid rewrites to one per {@link TEXT_REFRESH_MS}.
     * @private
     * @param {string} message
     * @returns {void}
     */
    _show(message) {
        this.visible = true;
        if (message === this._text.text) {
            return;
        }
        if (this._textTimer !== null) {
            this._pendingMessage = message;
            return;
        }
        this._applyMessage(message);
        this._textTimer = setTimeout(() => {
            this._textTimer = null;
            if (this._pendingMessage !== null && this._pendingMessage !== this._text.text) {
                this._applyMessage(this._pendingMessage);
            }
            this._pendingMessage = null;
        }, TEXT_REFRESH_MS);
    }

    /**
     * @private
     * @param {string} message
     * @returns {void}
     */
    _applyMessage(message) {
        this._text.text = message;
        this._background
            .clear()
            .roundRect(0, 0, this._text.width + PADDING_X * 2, this._text.height + PADDING_Y * 2, 4)
            .fill({color: PANEL_FILL, alpha: PANEL_FILL_ALPHA})
            .stroke({color: PANEL_BORDER, width: 1});
    }
}
