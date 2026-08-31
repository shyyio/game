import {CHUNK_PICK_ZOOM_SCALE, EXIT_HOTKEY, TILE_SIZE, ViewMode} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {OwnClaimsSyncEvent, ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {FriendListEvent} from "@/common/PlayerEvents.js";
import {StatusBarSection, hotkeyButton} from "@/client/hud/TopStatusBarLayer.js";
import {BottomBarAction} from "@/client/hud/BottomActionBarLayer.js";

// Entry glide skipped within a chunk of the centroid; the mode activates in place.
const GLIDE_MIN_DISTANCE_PX = CHUNK_SIZE * TILE_SIZE;

// This mode's id: both its map button id and its top status bar section id.
const MODE_ID = "claimSelection";

/**
 * Chunk administration input mode: the selected chunk, its widgets, and the mode's lifecycle.
 * Toggled by the player once they hold a chunk (the settle flow owns the state before that);
 * entering glides the viewport to the claim centroid.
 */
export class ClaimSelectionMode {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        this._claims = client.cache.view("chunkClaims");
        this._cursor = client.chunkCursor;
        this._on = false;
        // Entry glide in flight: the mode activates only once the viewport arrives.
        this._entering = false;
    }

    /**
     * @returns {boolean}
     */
    get active() {
        return this._on;
    }

    /**
     * Enters or exits the mode; entry is refused without claims, which is the settle flow's state.
     * Entry glides the viewport first, activating on arrival.
     * @param {boolean} on
     * @returns {void}
     */
    set(on) {
        if (on) {
            if (!this._on && !this._entering && this._hasClaims()) {
                this._enter();
            }
            return;
        }
        // An exit also abandons a pending entry glide's activation.
        this._entering = false;
        if (!this._on) {
            return;
        }
        this._on = false;
        this._cursor.clear();
        this.updateIndicators();
    }

    /**
     * @returns {void}
     */
    toggle() {
        this.set(!this.active && !this._entering);
    }

    /**
     * Drives the mode off the claim sync/update events.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof FriendListEvent) {
            this._client.chunkActionsLayer.refresh();
            this.updateIndicators();
            return;
        }
        if (!(event instanceof OwnClaimsSyncEvent) && !(event instanceof ChunkClaimUpdateEvent)) {
            return;
        }
        if (!this._hasClaims()) {
            this.set(false);
        }
        this._client.refreshToolbarVisibility();
        this._client.chunkActionsLayer.refresh();
        this._client.chunkSelectionLayer.refresh();
        this.updateIndicators();
    }

    /**
     * Zooming out of world mode selects the centered chunk (an aimed entry keeps its selection).
     * Zooming into world mode exits the mode.
     * @param {ViewMode} previous
     * @returns {void}
     */
    onViewMode(previous) {
        if (this._client.viewMode.current === ViewMode.WORLD) {
            this.set(false);
            return;
        }
        if (previous === ViewMode.WORLD && this.active && this._cursor.chunk === null) {
            this._cursor.selectCenterChunk();
        }
        this.updateIndicators();
    }

    /**
     * Syncs the center dot, frontier dashes, map buttons, and both bars to the mode.
     * @returns {void}
     */
    updateIndicators() {
        this._client.centerLock.refreshMarker();
        this._client.claimFrontierLayer.setModeActive(this.active);
        // Entry buttons only show outside the mode; inside, the bars own entry and exit.
        const showButtons = this._hasClaims() && !this.active;
        this._client.mapButtonsLayer.setButtonVisible(MODE_ID, showButtons);
        this._client.mapButtonsLayer.setButtonVisible("home", showButtons);
        this._client.topStatusBar.setSection(MODE_ID, this._statusBarSection());
        this._client.bottomActionBar.set(this._bottomBarAction());
    }

    /**
     * This mode's status-bar contribution: the mode's name and claim count with its Back button.
     * Null while inactive.
     * @private
     * @returns {StatusBarSection|null}
     */
    _statusBarSection() {
        if (!this.active) {
            return null;
        }
        const text = `${this._claims.ownCount()}/${this._claims.maxChunks} chunks claimed`;
        return new StatusBarSection(text, [hotkeyButton("Back", EXIT_HOTKEY, () => this.set(false))]);
    }

    /**
     * This mode's forward action: the selected chunk's status, with Confirm leaving the mode
     * (every claim change already committed). Null while inactive.
     * @private
     * @returns {BottomBarAction|null}
     */
    _bottomBarAction() {
        if (!this.active) {
            return null;
        }
        let text = this._client.chunkActionsLayer.statusText;
        if (text === null) {
            text = "Select a chunk";
        }
        return new BottomBarAction(text, () => this.set(false));
    }

    /**
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {void}
     */
    handleHover(tileX, tileY) {
        if (tileX === null) {
            this._cursor.clear();
            return;
        }
        if (!this.active) {
            return;
        }
        this._cursor.handleHover(tileX, tileY);
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} claimShortcut - Shift held: also claim the chunk if claimable
     * @returns {void}
     */
    handleSelect(tileX, tileY, claimShortcut) {
        if (!this.active) {
            return;
        }
        this._cursor.handleSelect(tileX, tileY, claimShortcut);
    }

    /**
     * Glides to the map aimed at the claims centroid, activating on arrival with the
     * centered chunk selected; an interrupted glide cancels the entry.
     * @private
     * @returns {void}
     */
    _enter() {
        const done = (arrived) => {
            if (!this._entering) {
                return;
            }
            this._entering = false;
            if (!arrived) {
                return;
            }
            this._on = true;
            this._cursor.selectCenterChunk();
            this.updateIndicators();
        };
        this._entering = true;
        const center = this._client.camera.ownClaimsCenter();
        if (this._client.viewMode.current === ViewMode.WORLD) {
            this._client.viewport.glideTo({x: center.x, y: center.y, scale: CHUNK_PICK_ZOOM_SCALE}, done);
            return;
        }
        if (this._farFromCenter(center)) {
            this._client.viewport.glideTo({x: center.x, y: center.y}, done);
            return;
        }
        done(true);
    }

    /**
     * Whether the viewport center sits further than {@link GLIDE_MIN_DISTANCE_PX} from a target.
     * @private
     * @param {{x: number, y: number}} target
     * @returns {boolean}
     */
    _farFromCenter(target) {
        const current = this._client.viewport.center;
        return Math.hypot(target.x - current.x, target.y - current.y) > GLIDE_MIN_DISTANCE_PX;
    }

    /**
     * @private
     * @returns {boolean}
     */
    _hasClaims() {
        return this._claims.hasOwnClaims();
    }
}
