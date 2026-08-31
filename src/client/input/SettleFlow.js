import {CHUNK_PICK_ZOOM_SCALE, MAP_MODE_SCALE_THRESHOLD, ViewMode} from "@/client/constants.js";
import {OwnClaimsSyncEvent, ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {StatusBarSection} from "@/client/hud/TopStatusBarLayer.js";

// Where the first claim lands the player: world mode's far edge, just past map mode.
const LANDING_ZOOM_SCALE = MAP_MODE_SCALE_THRESHOLD * 1.1;

// This flow's top status bar section id.
const FLOW_ID = "settle";

const WORLD_PROMPT = "No claimed chunks yet. Zoom out to claim your first one";
const MAP_PROMPT = "Claim your first chunk. You can change it later.";

/**
 * The first-claim flow: while the player holds no chunks the map picks one chunk and nothing else,
 * and the claim that lands drops them into the world on it. Owns the connect-time view.
 */
export class SettleFlow {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        this._claims = client.cache.view("chunkClaims");
        this._cursor = client.chunkCursor;
        this._active = false;
        // One-shot: the connect-time view (map zoom without claims, home with them).
        this._connectViewApplied = false;
    }

    /**
     * @returns {boolean}
     */
    get active() {
        return this._active;
    }

    /**
     * Drives the flow off the claim sync/update events; the connect-time sync settles the
     * claim count.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (!(event instanceof OwnClaimsSyncEvent) && !(event instanceof ChunkClaimUpdateEvent)) {
            return;
        }
        this._setActive(this._noClaims());
        if (event instanceof OwnClaimsSyncEvent && !this._connectViewApplied) {
            this._connectViewApplied = true;
            if (this._active) {
                this._client.viewport.glideTo({scale: CHUNK_PICK_ZOOM_SCALE});
            } else {
                this._client.camera.startAtHome();
            }
        }
    }

    /**
     * Zooming out of world mode selects the centered chunk; zooming in drops the selection, since
     * the prompt sends the player back out to the map.
     * @param {ViewMode} previous
     * @returns {void}
     */
    onViewMode(previous) {
        if (!this._active) {
            return;
        }
        if (this._client.viewMode.current === ViewMode.WORLD) {
            this._cursor.clear();
        } else if (previous === ViewMode.WORLD) {
            this._cursor.selectCenterChunk();
        }
        this.updateIndicators();
    }

    /**
     * Syncs the center dot and the status bar to the flow.
     * @returns {void}
     */
    updateIndicators() {
        this._client.centerLock.refreshMarker();
        this._client.topStatusBar.setSection(FLOW_ID, this._statusBarSection());
    }

    /**
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {void}
     */
    handleHover(tileX, tileY) {
        this._cursor.handleHover(tileX, tileY);
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} claimShortcut - Shift held: also claim the chunk if claimable
     * @returns {void}
     */
    handleSelect(tileX, tileY, claimShortcut) {
        this._cursor.handleSelect(tileX, tileY, claimShortcut);
    }

    /**
     * Entering aims at the centered chunk; leaving hands the player to the world on their new
     * claim, the flow's one way out.
     * @private
     * @param {boolean} active
     * @returns {void}
     */
    _setActive(active) {
        if (active === this._active) {
            return;
        }
        this._active = active;
        if (active) {
            if (this._client.viewMode.current !== ViewMode.WORLD) {
                this._cursor.selectCenterChunk();
            }
        } else {
            this._cursor.clear();
            this._land();
        }
        this.updateIndicators();
    }

    /**
     * @private
     * @returns {void}
     */
    _land() {
        const center = this._client.camera.ownClaimsCenter();
        if (center === null) {
            return;
        }
        this._client.viewport.glideTo({x: center.x, y: center.y, scale: LANDING_ZOOM_SCALE});
    }

    /**
     * The prompt, differing by zoom band; null while inactive.
     * @private
     * @returns {StatusBarSection|null}
     */
    _statusBarSection() {
        if (!this._active) {
            return null;
        }
        if (this._client.viewMode.current === ViewMode.WORLD) {
            return new StatusBarSection(WORLD_PROMPT);
        }
        return new StatusBarSection(MAP_PROMPT);
    }

    /**
     * @private
     * @returns {boolean}
     */
    _noClaims() {
        return this._claims.ownPlayerId !== null && !this._claims.hasOwnClaims();
    }
}
