import {Container, Graphics, Text} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {GAME_FONT, TILE_SIZE, ViewMode} from "@/client/constants.js";
import {CHUNK_SIZE, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkCenter, chunkOrdinal, chunkOrigin, chunkPosition, getOrCreate, inRegion} from "@/common/util.js";
import {claimColor, CLAIM_FILL_ALPHA, CLAIM_BORDER_ALPHA} from "@/client/Theme.js";
import {ChunkPermission} from "@/common/ClaimEvents.js";
import {drawHomeIcon, drawFriendIcon} from "@/client/hud/icons.js";

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;

// World-space inset keeping a chunk's permission badge off its corner.
const BADGE_CORNER_INSET = TILE_SIZE * 6;

// World-space border width at map zoom.
const BORDER_WIDTH = TILE_SIZE;

// Thin perimeter line at world (build) zoom.
const WORLD_BORDER_WIDTH = 4;
const WORLD_BORDER_ALPHA = 0.35;

// Constant screen-pixel label size (rescaled per tick).
const LABEL_FONT_SIZE = 15;
// World-space inset keeping a clamped label off its chunk's edge.
const LABEL_CLAMP_MARGIN = TILE_SIZE * 8;

/**
 * Claim borders with owner labels (home glyph for the own player) at map/overworld zoom;
 * thin perimeter lines at world zoom. Not chunk-mounted: renders the claims cache's last-seen
 * ownership map, whole-region.
 */
export class ChunkClaimsDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ClientCache} state
     */
    constructor(state) {
        super();
        this._claims = state.view("chunkClaims");
        this._players = state.view("players");
        // Chunk ordinal -> its border Graphics.
        this._graphics = new Map();
        // Chunk ordinal -> its permission badge Graphics, present only where notable.
        this._badges = new Map();
        // Owner playerId -> username Text.
        this._labels = new Map();
        // Home glyph on the own player's territory.
        this._homeMarker = null;
        // Above every chunk graphic; hidden at world zoom.
        this._labelLayer = new Container();
        this._labelLayer.visible = false;
        this.addChild(this._labelLayer);
        this._worldMode = true;
        this._overworld = false;
        // Selected chunk's graphic hides so the selection square replaces it.
        this._selectedChunk = null;
        // Batches neighbor redraws and label rebuilds until the next tick.
        this._dirtyChunks = new Set();
        this._labelsDirty = false;
        // Last applied label scale; skips the rescale at constant zoom.
        this._labelScale = null;
        state.subscribe("chunkClaims.ownerByChunk", (chunk, owner) => {
            if (owner === undefined) {
                this._dropChunk(chunk);
                this._dropBadge(chunk);
            } else {
                this._drawChunk(chunk, owner);
                this._updateBadge(chunk, owner);
            }
            // Neighbors' edges shift too.
            this._dirtyChunks.add(chunk);
            this._labelsDirty = true;
        });
        // A permission-only change (same owner) skips the ownerByChunk notify above.
        state.subscribe("chunkClaims.permissionByChunk", (chunk, permission) => {
            if (permission === undefined) {
                return;
            }
            this._updateBadge(chunk, this._claims.ownerOf(chunk));
        });
        // A grant toggling changes whether that owner's friends-only chunks read as buildable.
        state.subscribe("chunkClaims.grantedByIds", (playerId) => {
            for (const chunk of this._graphics.keys()) {
                if (this._claims.ownerOf(chunk) === playerId) {
                    this._updateBadge(chunk, playerId);
                }
            }
        });
        // A name push can arrive after its owner's claims, or rename them.
        state.subscribe("players.usernameByPlayer", () => {
            this._labelsDirty = true;
        });
    }

    get layerIndex() {
        return 45;
    }

    tick(frame, deltaMS, visibleChunks) {
        this._drainDirty();
        if (!this._labelLayer.visible || this._labelLayer.children.length === 0 || this.viewport === null) {
            return;
        }
        // Labels hold a constant screen size across zoom.
        const scale = 1 / this.viewport.scale.x;
        if (scale === this._labelScale) {
            return;
        }
        this._labelScale = scale;
        for (const child of this._labelLayer.children) {
            child.scale.set(scale);
        }
    }

    /**
     * Redraws affected neighbors and rebuilds labels once per tick.
     * @private
     * @returns {void}
     */
    _drainDirty() {
        if (this._dirtyChunks.size === 0 && !this._labelsDirty) {
            return;
        }
        const neighbors = new Set();
        for (const chunk of this._dirtyChunks) {
            const position = chunkPosition(chunk);
            for (let dx = -1; dx <= 1; dx += 1) {
                for (let dy = -1; dy <= 1; dy += 1) {
                    if (dx === 0 && dy === 0) {
                        continue;
                    }
                    const x = position.x + dx;
                    const y = position.y + dy;
                    if (!inRegion(x, y)) {
                        continue;
                    }
                    const neighbor = chunkOrdinal(x, y);
                    if (this._graphics.has(neighbor)) {
                        neighbors.add(neighbor);
                    }
                }
            }
        }
        this._dirtyChunks.clear();
        for (const neighbor of neighbors) {
            this._drawChunk(neighbor, this._claims.ownerOf(neighbor));
        }
        if (this._labelsDirty) {
            this._labelsDirty = false;
            this._refreshLabels();
        }
    }

    /**
     * Rebuilds the owner labels: one username per owner at their territory's centroid.
     * @private
     * @returns {void}
     */
    _refreshLabels() {
        const territories = new Map();
        let ownTerritory = null;
        for (const chunk of this._graphics.keys()) {
            const owner = this._claims.ownerOf(chunk);
            let territory;
            // Own territory gets the home glyph, not a label.
            if (owner === this._claims.ownPlayerId) {
                if (ownTerritory === null) {
                    ownTerritory = {chunks: [], sumX: 0, sumY: 0};
                }
                territory = ownTerritory;
            } else {
                territory = getOrCreate(territories, owner, () => ({chunks: [], sumX: 0, sumY: 0}));
            }
            const center = chunkCenter(chunk);
            territory.chunks.push(chunk);
            territory.sumX += center.x * TILE_SIZE;
            territory.sumY += center.y * TILE_SIZE;
        }
        // Next tick rescales all labels.
        this._labelScale = null;
        this._refreshHomeMarker(ownTerritory);
        for (const [owner, label] of this._labels) {
            if (!territories.has(owner)) {
                this._labelLayer.removeChild(label);
                label.destroy();
                this._labels.delete(owner);
            }
        }
        for (const [owner, territory] of territories) {
            const label = getOrCreate(this._labels, owner, () => {
                const created = new Text({
                    text: "",
                    style: {
                        fontFamily: GAME_FONT,
                        fontSize: LABEL_FONT_SIZE,
                        fill: claimColor(owner),
                        fontWeight: "bold",
                        stroke: {color: 0xffffff, width: 3},
                    },
                });
                created.anchor.set(0.5);
                this._labelLayer.addChild(created);
                return created;
            });
            label.text = this._players.usernameOf(owner);
            const position = this._labelPosition(territory);
            label.position.set(position.x, position.y);
        }
    }

    /**
     * (Re)places the home glyph on the own player's territory, or drops it with none.
     * @private
     * @param {{chunks: number[], sumX: number, sumY: number}|null} territory
     * @returns {void}
     */
    _refreshHomeMarker(territory) {
        if (territory === null) {
            if (this._homeMarker !== null) {
                this._labelLayer.removeChild(this._homeMarker);
                this._homeMarker.destroy();
                this._homeMarker = null;
            }
            return;
        }
        if (this._homeMarker === null) {
            this._homeMarker = new Graphics();
            // White halo under the colored glyph.
            drawHomeIcon(this._homeMarker, 0xffffff, 6);
            drawHomeIcon(this._homeMarker, claimColor(this._claims.ownPlayerId), 3);
            this._labelLayer.addChild(this._homeMarker);
        }
        const position = this._labelPosition(territory);
        this._homeMarker.position.set(position.x, position.y);
    }

    /**
     * The territory's centroid clamped into the nearest owned chunk.
     * @private
     * @param {{chunks: number[], sumX: number, sumY: number}} territory
     * @returns {{x: number, y: number}}
     */
    _labelPosition(territory) {
        const centroidX = territory.sumX / territory.chunks.length;
        const centroidY = territory.sumY / territory.chunks.length;
        let nearest = null;
        let nearestDistance = Infinity;
        for (const chunk of territory.chunks) {
            const center = chunkCenter(chunk);
            const dx = center.x * TILE_SIZE - centroidX;
            const dy = center.y * TILE_SIZE - centroidY;
            const distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = chunk;
            }
        }
        const origin = chunkOrigin(nearest);
        const margin = LABEL_CLAMP_MARGIN;
        return {
            x: Math.max(origin.x * TILE_SIZE + margin, Math.min((origin.x + CHUNK_SIZE) * TILE_SIZE - margin, centroidX)),
            y: Math.max(origin.y * TILE_SIZE + margin, Math.min((origin.y + CHUNK_SIZE) * TILE_SIZE - margin, centroidY)),
        };
    }

    /**
     * Always shown; the zoom band picks the style.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        const world = mode === ViewMode.WORLD;
        const overworld = mode === ViewMode.OVERWORLD;
        this._labelLayer.visible = !world;
        if (world !== this._worldMode || overworld !== this._overworld) {
            this._worldMode = world;
            this._overworld = overworld;
            for (const chunk of this._graphics.keys()) {
                this._drawChunk(chunk, this._claims.ownerOf(chunk));
            }
            for (const badge of this._badges.values()) {
                badge.visible = !overworld;
            }
        }
    }

    /**
     * @param {number|null} chunk
     * @returns {void}
     */
    setSelectedChunk(chunk) {
        if (chunk === this._selectedChunk) {
            return;
        }
        const previous = this._graphics.get(this._selectedChunk);
        if (previous !== undefined) {
            previous.visible = true;
        }
        this._selectedChunk = chunk;
        const current = this._graphics.get(chunk);
        if (current !== undefined) {
            current.visible = false;
        }
    }

    /**
     * @private
     * @param {number} chunk
     * @returns {void}
     */
    _dropChunk(chunk) {
        const graphics = this._graphics.get(chunk);
        if (graphics === undefined) {
            return;
        }
        this.removeChild(graphics);
        graphics.destroy();
        this._graphics.delete(chunk);
    }

    /**
     * The badge glyph notable to the own player for `chunk`, or null: own chunks read their own
     * permission (only-me is the silent default); foreign chunks read whether the own player
     * specifically can build there, not the raw permission value.
     * @private
     * @param {number} chunk
     * @param {number} owner
     * @returns {function(Graphics, number, number): void|null}
     */
    _badgeIconFor(chunk, owner) {
        const permission = this._claims.permissionOf(chunk);
        if (owner === this._claims.ownPlayerId) {
            if (permission === ChunkPermission.PERMISSION_FRIENDS) {
                return drawFriendIcon;
            }
            return null;
        }
        if (permission === ChunkPermission.PERMISSION_FRIENDS && this._claims.isFriendsWithMe(owner)) {
            return drawFriendIcon;
        }
        return null;
    }

    /**
     * (Re)draws or drops `chunk`'s permission badge at its top-left corner.
     * @private
     * @param {number} chunk
     * @param {number} owner
     * @returns {void}
     */
    _updateBadge(chunk, owner) {
        const drawIcon = this._badgeIconFor(chunk, owner);
        if (drawIcon === null) {
            this._dropBadge(chunk);
            return;
        }
        let badge = this._badges.get(chunk);
        if (badge === undefined) {
            badge = new Graphics();
            badge.visible = !this._overworld;
            this._labelLayer.addChild(badge);
            this._badges.set(chunk, badge);
            // A fresh child needs the next tick's rescale; skip only fires on an unchanged zoom.
            this._labelScale = null;
        } else {
            badge.clear();
        }
        // White halo under the colored glyph, matching the home marker's technique.
        drawIcon(badge, 0xffffff, 6);
        drawIcon(badge, claimColor(owner), 3);
        const origin = chunkOrigin(chunk);
        badge.position.set(
            origin.x * TILE_SIZE + BADGE_CORNER_INSET,
            origin.y * TILE_SIZE + BADGE_CORNER_INSET,
        );
    }

    /**
     * @private
     * @param {number} chunk
     * @returns {void}
     */
    _dropBadge(chunk) {
        const badge = this._badges.get(chunk);
        if (badge === undefined) {
            return;
        }
        this._labelLayer.removeChild(badge);
        badge.destroy();
        this._badges.delete(chunk);
    }

    /**
     * The owner of the chunk one step from `chunk`, or PLAYER_ID_NONE off the region edge.
     * @private
     * @param {number} chunk
     * @param {number} dx
     * @param {number} dy
     * @returns {number}
     */
    _neighborOwner(chunk, dx, dy) {
        const position = chunkPosition(chunk);
        const x = position.x + dx;
        const y = position.y + dy;
        if (!inRegion(x, y)) {
            return PLAYER_ID_NONE;
        }
        return this._claims.ownerOf(chunkOrdinal(x, y));
    }

    /**
     * Border strips on edges facing another owner, plus a translucent fill.
     * @private
     * @param {number} chunk
     * @param {number} owner
     * @returns {void}
     */
    _drawChunk(chunk, owner) {
        const graphics = getOrCreate(this._graphics, chunk, () => {
            const created = new Graphics();
            const origin = chunkOrigin(chunk);
            created.position.set(origin.x * TILE_SIZE, origin.y * TILE_SIZE);
            // Below the label layer.
            this.addChildAt(created, 0);
            return created;
        });
        graphics.visible = chunk !== this._selectedChunk;
        graphics.clear();
        const color = claimColor(owner);
        if (this._worldMode) {
            this._drawBorder(graphics, chunk, owner, WORLD_BORDER_WIDTH);
            graphics.fill({color, alpha: WORLD_BORDER_ALPHA});
            return;
        }
        graphics
            .rect(0, 0, CHUNK_PX, CHUNK_PX)
            .fill({color, alpha: CLAIM_FILL_ALPHA});
        // Overworld zoom: fill alone, borders too thin to read.
        if (this._overworld) {
            return;
        }
        this._drawBorder(graphics, chunk, owner, BORDER_WIDTH);
        graphics.fill({color, alpha: CLAIM_BORDER_ALPHA});
    }

    /**
     * Queues the border rects at `width`; the caller fills them.
     * @private
     * @param {Graphics} graphics
     * @param {number} chunk
     * @param {number} owner
     * @param {number} width
     * @returns {void}
     */
    _drawBorder(graphics, chunk, owner, width) {
        const top = this._neighborOwner(chunk, 0, -1) !== owner;
        const bottom = this._neighborOwner(chunk, 0, 1) !== owner;
        const left = this._neighborOwner(chunk, -1, 0) !== owner;
        const right = this._neighborOwner(chunk, 1, 0) !== owner;
        if (top) {
            graphics.rect(0, 0, CHUNK_PX, width);
        }
        if (bottom) {
            graphics.rect(0, CHUNK_PX - width, CHUNK_PX, width);
        }
        // Inset vertical strips past drawn horizontal ones; overlap would double the alpha.
        const topInset = top ? width : 0;
        const bottomInset = bottom ? width : 0;
        if (left) {
            graphics.rect(0, topInset, width, CHUNK_PX - topInset - bottomInset);
        }
        if (right) {
            graphics.rect(CHUNK_PX - width, topInset, width, CHUNK_PX - topInset - bottomInset);
        }
        // Diagonal same-owner contact: cap the pinched corner (top-corner chunk only, no double-blend).
        if (top && left && this._neighborOwner(chunk, -1, -1) === owner) {
            graphics.rect(-width / 2, -width / 2, width, width);
        }
        if (top && right && this._neighborOwner(chunk, 1, -1) === owner) {
            graphics.rect(CHUNK_PX - width / 2, -width / 2, width, width);
        }
        // Concave corner (edge neighbors same-owner, diagonal foreign): bridge the turn square.
        if (!top && !left && this._neighborOwner(chunk, -1, -1) !== owner) {
            graphics.rect(0, 0, width, width);
        }
        if (!top && !right && this._neighborOwner(chunk, 1, -1) !== owner) {
            graphics.rect(CHUNK_PX - width, 0, width, width);
        }
        if (!bottom && !left && this._neighborOwner(chunk, -1, 1) !== owner) {
            graphics.rect(0, CHUNK_PX - width, width, width);
        }
        if (!bottom && !right && this._neighborOwner(chunk, 1, 1) !== owner) {
            graphics.rect(CHUNK_PX - width, CHUNK_PX - width, width, width);
        }
    }
}
