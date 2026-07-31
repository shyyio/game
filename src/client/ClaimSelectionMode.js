import {OVERWORLD_SCALE_THRESHOLD, TILE_SIZE, ViewMode} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkId, inRegion} from "@/common/util.js";
import {OwnClaimsSyncEvent, ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {FriendListEvent} from "@/common/PlayerEvents.js";
import {StatusBarSection, StatusBarButton} from "@/client/TopStatusBarLayer.js";
import Mobile from "@/client/Mobile.js";

// Where the mode's auto-zoom lands: map mode's far edge, just shy of overworld.
const MODE_ZOOM_SCALE = OVERWORLD_SCALE_THRESHOLD * 1.1;

// Entry glide skipped within a chunk of the centroid; the mode activates in place.
const GLIDE_MIN_DISTANCE_PX = CHUNK_SIZE * TILE_SIZE;

// This mode's owned id in the top status bar.
const STATUS_BAR_SECTION_ID = "claimSelection";

const WORLD_ONBOARDING = "No claimed chunks yet — zoom out to the map to claim your first one";
const MAP_ONBOARDING = "Select an unclaimed chunk and press Claim chunk";

/**
 * Claim selection input mode: the selected chunk, its widgets, and the mode's lifecycle.
 * Toggled by the player, forced while they hold no claimed chunks; entering glides the
 * viewport to the claim centroid.
 */
export class ClaimSelectionMode {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        this._claims = client.cache.view("chunkClaims");
        this._on = false;
        this._forced = false;
        // Entry glide in flight: the mode activates only once the viewport arrives.
        this._entering = false;
        this._selectedChunk = null;
        // One-shot: the connect-time view (map zoom without claims, home with them).
        this._connectViewApplied = false;
    }

    /**
     * Whether the mode is active: toggled on, or forced with no claimed chunks.
     * @returns {boolean}
     */
    get active() {
        return this._on || this._noClaims();
    }

    /**
     * Enters or exits the mode; exit is refused while forced. Entry glides the viewport
     * first, activating on arrival.
     * @param {boolean} on
     * @returns {void}
     */
    set(on) {
        if (on) {
            if (!this._on && !this._entering) {
                this._enter();
            }
            return;
        }
        // An exit also abandons a pending entry glide's activation.
        this._entering = false;
        if (!this._on || this._noClaims()) {
            return;
        }
        this._on = false;
        this._selectChunk(null);
        this._client.chunkSelectionLayer.setHoverChunk(null);
        this.updateIndicators();
    }

    /**
     * @returns {void}
     */
    toggle() {
        if (this._entering) {
            this.set(false);
            return;
        }
        this.set(!this.active);
    }

    /**
     * Drives the mode off the claim sync/update events; the connect-time sync settles the
     * claim count.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof FriendListEvent) {
            this._client.chunkInfoPanelLayer.refresh();
            return;
        }
        if (!(event instanceof OwnClaimsSyncEvent) && !(event instanceof ChunkClaimUpdateEvent)) {
            return;
        }
        const noClaims = this._noClaims();
        // Forced mode ends sticky: the first claim keeps the mode on until the player exits.
        if (this._forced && !noClaims) {
            this._on = true;
        }
        this._forced = noClaims;
        this.updateIndicators();
        // No claimed chunks means nothing to build on: the toolbar hides until the first claim.
        this._client.toolbarLayer.visible = !noClaims;
        this._client.chunkInfoPanelLayer.refresh();
        this._client.chunkSelectionLayer.refresh();
        if (event instanceof OwnClaimsSyncEvent && !this._connectViewApplied) {
            this._connectViewApplied = true;
            if (noClaims) {
                this._client.viewport.glideTo({scale: MODE_ZOOM_SCALE});
            } else {
                this._client.startAtHome();
            }
        }
    }

    /**
     * Zooming out of world mode selects the centered chunk (an aimed entry keeps its selection).
     * @param {ViewMode} previous
     * @returns {void}
     */
    onViewMode(previous) {
        if (previous === ViewMode.WORLD && this.active && this._selectedChunk === null) {
            this._selectCenterChunk();
        }
        this.updateIndicators();
    }

    /**
     * Syncs the center dot, frontier dashes, and map buttons to the mode.
     * @returns {void}
     */
    updateIndicators() {
        this._client.centerMarkerLayer.setActive(
            this._client.centerLock && this.active && this._client.viewMode !== ViewMode.WORLD,
        );
        this._client.claimFrontierLayer.setModeActive(this.active);
        this._client.mapButtonsLayer.setActive("claimSelection", this.active);
        // Forced mode can't be exited, so its close button hides with it; home needs claims.
        this._client.mapButtonsLayer.setButtonVisible("claimSelection", !this._noClaims());
        this._client.mapButtonsLayer.setButtonVisible("home", !this._noClaims());
        this._client.topStatusBar.setSection(STATUS_BAR_SECTION_ID, this._statusBarSection());
    }

    /**
     * This mode's status-bar contribution: the onboarding text while forced with no claims, or
     * the claim count with an exit button once there's somewhere to exit to. Null while inactive.
     * @private
     * @returns {StatusBarSection|null}
     */
    _statusBarSection() {
        if (!this.active) {
            return null;
        }
        if (this._noClaims()) {
            let text;
            if (this._client.viewMode === ViewMode.WORLD) {
                text = WORLD_ONBOARDING;
            } else {
                text = MAP_ONBOARDING;
            }
            return new StatusBarSection(text);
        }
        const text = `${this._claims.ownCount()}/${this._claims.maxChunks} chunks claimed`;
        let exitLabel = "Back";
        if (!Mobile.enabled) {
            exitLabel = "Back [Q]";
        }
        return new StatusBarSection(text, [new StatusBarButton(exitLabel, () => this.set(false))]);
    }

    /**
     * Routes the map-mode hover: center-lock selects the centered chunk, desktop only moves
     * the hover square; a null tile clears everything.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {void}
     */
    handleHover(tileX, tileY) {
        if (tileX === null) {
            this._selectChunk(null);
            this._client.chunkSelectionLayer.setHoverChunk(null);
            return;
        }
        if (!this.active) {
            return;
        }
        const chunk = this._chunkAt(tileX, tileY);
        if (this._client.centerLock) {
            this._selectChunk(chunk);
        } else {
            this._client.chunkSelectionLayer.setHoverChunk(chunk);
        }
    }

    /**
     * A map-mode tap selects the chunk under it.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    handleSelect(tileX, tileY) {
        if (!this.active) {
            return;
        }
        this._selectChunk(this._chunkAt(tileX, tileY));
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
            this._selectCenterChunk();
            this.updateIndicators();
        };
        this._entering = true;
        const center = this._client.ownClaimsCenter();
        if (this._client.viewMode === ViewMode.WORLD) {
            if (center === null) {
                this._client.viewport.glideTo({scale: MODE_ZOOM_SCALE}, done);
            } else {
                this._client.viewport.glideTo({x: center.x, y: center.y, scale: MODE_ZOOM_SCALE}, done);
            }
            return;
        }
        if (center !== null && this._farFromCenter(center)) {
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
     * Targets the chunk panel and the selection square; null clears both.
     * @private
     * @param {number|null} chunk
     * @returns {void}
     */
    _selectChunk(chunk) {
        this._selectedChunk = chunk;
        this._client.chunkSelectionLayer.setSelectedChunk(chunk);
        this._client.chunkClaimsLayer.setSelectedChunk(chunk);
        this._client.claimFrontierLayer.setSelectedChunk(chunk);
        if (chunk === null) {
            this._client.chunkInfoPanelLayer.hide();
        } else {
            this._client.chunkInfoPanelLayer.showChunk(chunk);
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _selectCenterChunk() {
        const center = this._client.viewport.center;
        this._selectChunk(this._chunkAt(
            Math.floor(center.x / TILE_SIZE),
            Math.floor(center.y / TILE_SIZE),
        ));
    }

    /**
     * The chunk under a tile, or null outside the region.
     * @private
     * @param {number} tileX
     * @param {number} tileY
     * @returns {number|null}
     */
    _chunkAt(tileX, tileY) {
        const chunkX = Math.floor(tileX / CHUNK_SIZE);
        const chunkY = Math.floor(tileY / CHUNK_SIZE);
        if (!inRegion(chunkX, chunkY)) {
            return null;
        }
        return chunkId(tileX, tileY);
    }

    /**
     * @private
     * @returns {boolean}
     */
    _noClaims() {
        return this._claims.ownPlayerId !== null && this._claims.ownCount() === 0;
    }
}
