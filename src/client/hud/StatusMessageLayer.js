import {Container, Text} from "pixi.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {GAME_FONT} from "@/client/constants.js";
import {HudLayer} from "@/client/hud/HudLayer.js";
import {PANEL_TINT, PANEL_TINT_TEXT} from "@/client/Theme.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import SafeArea from "@/client/SafeArea.js";

// Screen-pixel inset of the panel from the left edge.
const MARGIN = 12;
const PADDING_X = 12;
const PADDING_Y = 8;
// Gap between the outer frame and the sunken inset body.
const FRAME_MARGIN = 6;

// Loading counts can change several times a frame while syncs drain, and every Text write
// re-rasterizes its canvas; message writes coalesce to one per interval.
const TEXT_REFRESH_MS = 100;

/**
 * Static top-left status overlay: "Connecting…" then "Loading... x / y" while chunks subscribe.
 */
export class StatusMessageLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this.textureRegistry = null;
        // Display-only: never a hit target (the stage is interactive for mobile pinch).
        this.eventMode = "none";
        this.zIndex = HudLayer.STATUS;
        this.visible = false;
        this._topOffset = 0;
        this._connecting = false;
        // Reconnect/shutdown status, when set, takes priority over connecting/loading.
        this._override = null;
        // Chunks already subscribed, so a re-issued viewport request only counts new ones.
        this._subscribed = new Set();
        // Chunks in the active load; total = _batch.size, loaded = _batch.size - _pending.size.
        // A chunk panned out of view drops from the batch, so total stays currently-relevant.
        this._batch = new Set();
        // Batch chunks still awaiting a ChunkSubscribeEvent.
        this._pending = new Set();
        // Message-write coalescing: the timer gating the next Text write, and the message to
        // apply when it fires.
        this._textTimer = null;
        this._pendingMessage = null;
        // Reports the panel's occupied height, so whatever stacks under it follows.
        this._onChange = null;
        this._height = 0;

        this._panel = new Container();
        this._layoutPanel();
        this._box = {frame: null, inset: null};
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TINT_TEXT},
        });
        this._text.x = FRAME_MARGIN + PADDING_X;
        this._text.y = FRAME_MARGIN + PADDING_Y;
        this._panel.addChild(this._text);
        this.addChild(this._panel);
        app.renderer.on("resize", () => this._layoutPanel());
    }

    /**
     * Registers the callback invoked with the panel's occupied height (0 while hidden) whenever
     * it changes.
     * @param {function(height: number): void} callback
     * @returns {void}
     */
    onChange(callback) {
        this._onChange = callback;
    }

    /**
     * Shifts the panel down by `offset` px, clearing whatever currently occupies the top edge
     * (the full-width top status bar).
     * @param {number} offset
     * @returns {void}
     */
    setTopOffset(offset) {
        if (offset === this._topOffset) {
            return;
        }
        this._topOffset = offset;
        this._layoutPanel();
    }

    /**
     * Positions the panel clear of the left safe-area inset, below whatever occupies the top edge.
     * @private
     * @returns {void}
     */
    _layoutPanel() {
        this._panel.x = SafeArea.insets().left + MARGIN;
        this._panel.y = this._topOffset;
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
     * Shows a persistent message (reconnecting, server restarting) that takes priority over the
     * connecting/loading display until cleared.
     * @param {string} message
     * @returns {void}
     */
    setOverride(message) {
        this._override = message;
        this._refresh();
    }

    /**
     * Clears the override, resuming the connecting/loading display.
     * @returns {void}
     */
    clearOverride() {
        if (this._override === null) {
            return;
        }
        this._override = null;
        this._refresh();
    }

    /**
     * Forgets every subscribed/pending chunk, so a resync's re-requested viewport counts as fresh
     * rather than already-subscribed. Used after a reconnect, when the server has no memory of
     * this connection's old subscriptions.
     * @returns {void}
     */
    reset() {
        this._subscribed.clear();
        this._batch.clear();
        this._pending.clear();
    }

    /**
     * Begins tracking a viewport request; not-yet-subscribed chunks become the loading total.
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
            // A chunk that left drops from total (and pending, if not yet subscribed).
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
        if (this._override !== null) {
            this._show(this._override);
        } else if (this._connecting) {
            this._show("Connecting…");
        } else if (this._pending.size > 0) {
            this._show(`Loading... ${this._batch.size - this._pending.size} / ${this._batch.size}`);
        } else {
            this.visible = false;
            this._reportHeight();
        }
    }

    /**
     * Notifies the host when the occupied height changes.
     * @private
     * @returns {void}
     */
    _reportHeight() {
        let height = 0;
        if (this.visible) {
            height = this._text.height + (PADDING_Y + FRAME_MARGIN) * 2;
        }
        if (height === this._height) {
            return;
        }
        this._height = height;
        if (this._onChange !== null) {
            this._onChange(height);
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
        this._reportHeight();
        if (message === this._text.text) {
            return;
        }
        if (this._textTimer !== null) {
            this._pendingMessage = message;
            return;
        }
        this._applyMessage(message);
        this._armTextTimer();
    }

    /**
     * Gates the next Text write to one per {@link TEXT_REFRESH_MS}.
     * @private
     * @returns {void}
     */
    _armTextTimer() {
        this._textTimer = window.setTimeout(() => {
            this._textTimer = null;
            const pending = this._pendingMessage;
            this._pendingMessage = null;
            if (pending !== null && pending !== this._text.text) {
                this._applyMessage(pending);
                this._armTextTimer();
            }
        }, TEXT_REFRESH_MS);
    }

    /**
     * @private
     * @param {string} message
     * @returns {void}
     */
    _applyMessage(message) {
        this._text.text = message;
        this._rebuildBackground();
        this._reportHeight();
    }

    /**
     * Rebuilds the background sized to the current text; no-op until textureRegistry is assigned.
     * @private
     * @returns {void}
     */
    _rebuildBackground() {
        if (this.textureRegistry === null) {
            return;
        }
        const width = this._text.width + (PADDING_X + FRAME_MARGIN) * 2;
        const height = this._text.height + (PADDING_Y + FRAME_MARGIN) * 2;
        this._box = UIPanel.rebuildFramedBox(this._panel, this._box, this.textureRegistry, width, height, PANEL_TINT, FRAME_MARGIN);
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._text.style.fill = PANEL_TINT_TEXT;
        this.refreshBackground();
    }

    /**
     * Rebuilds the background for the already-showing message, once textureRegistry becomes available.
     * @returns {void}
     */
    refreshBackground() {
        if (this.textureRegistry !== null && this.visible) {
            this._rebuildBackground();
        }
    }
}
