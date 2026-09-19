import {Container, FillGradient, Graphics, GraphicsContext, Sprite} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {DisplayPool} from "@/client/layers/DisplayPool.js";
import {KeyedDisplayPool} from "@/client/layers/KeyedDisplayPool.js";
import {fitIconScale} from "@/client/layers/pixiUtils.js";
import {ViewMode} from "@/client/constants.js";
import {EMPTY} from "@/sim/AbstractComponent.js";

// The box an item sprite is scaled into, and the disc shadowed under it so the icon reads over
// the machine art: black under the icon, fading out to nothing at the disc's edge.
const PRODUCT_ICON_SIZE = 44;
const SHADOW_RADIUS = 30;
const SHADOW_CENTER_COLOR = "0x00000066";
const SHADOW_EDGE_COLOR = "0x00000000";

/**
 * How big a badge draws over one size of footprint, in each zoom band.
 */
class BadgeScaleEntry {

    /**
     * @param {number} worldScale
     * @param {number} mapScale
     */
    constructor(worldScale, mapScale) {
        this.worldScale = worldScale;
        this.mapScale = mapScale;
    }
}

// Indexed by the footprint's longest side in tiles; badges stop growing past the last entry.
const BADGE_SCALES = [
    new BadgeScaleEntry(1, 1.3),
    new BadgeScaleEntry(1.5, 2),
    new BadgeScaleEntry(2, 3),
];

// Idle badges kept for reuse; overflow is destroyed instead of parked.
const BADGE_POOL_LIMIT = 128;

/**
 * The footprint's longest side, in tiles.
 * @param {TileBounds} bounds
 * @returns {number}
 */
export function productBadgeFootprintTiles(bounds) {
    return Math.max(bounds.maxTileX - bounds.minTileX + 1, bounds.maxTileY - bounds.minTileY + 1);
}

/**
 * How big a badge over a footprint that many tiles long draws in the current zoom band.
 * @param {boolean} isMapMode
 * @param {number} tiles
 * @returns {number}
 */
export function productBadgeScale(isMapMode, tiles) {
    const entry = BADGE_SCALES[Math.min(tiles - 1, BADGE_SCALES.length - 1)];
    if (isMapMode) {
        return entry.mapScale;
    }
    return entry.worldScale;
}

/**
 * The detailed overlay: every object that produces something shows the item it produced last,
 * centered on its footprint over a shadow disc. Off until the player toggles it on.
 */
export class ProductBadgeLayer extends AbstractDrawLayer {

    /**
     * @param {ItemRegistry} items item types merged across mods
     */
    constructor(items) {
        super();
        this._items = items;
        this._isEnabled = false;
        this.visible = false;
        this._viewMode = ViewMode.WORLD;
        this._isMapMode = false;
        /**
         * The shadow disc every badge draws, rasterized with the first badge.
         * @type {GraphicsContext|null}
         * @private
         */
        this._shadow = null;
        /**
         * Live badges keyed by objectRef.
         * @type {KeyedDisplayPool}
         * @private
         */
        this._badges = new KeyedDisplayPool(new DisplayPool(
            () => {
                const badge = new ProductBadgeSprite(this._getShadowContext());
                this.addChild(badge);
                return badge;
            },
            badge => {
                badge.visible = false;
                badge.itemTypeId = EMPTY;
            },
            badge => {
                badge.visible = true;
            },
            BADGE_POOL_LIMIT,
        ));
        /**
         * Producers whose badge is rebuilt on the next tick.
         * @type {Set<number>}
         * @private
         */
        this._dirtyObjects = new Set();
        /**
         * Set by switching on: every cached producer's badge builds on the next tick.
         * @type {boolean}
         * @private
         */
        this._isStale = false;
    }

    get layerIndex() {
        // Above the object sprites (20) and the staffing dots (21), so the product reads over both.
        return 22;
    }

    /**
     * Shows or hides the overlay: every cached producer's badge is built on the next tick, and
     * switching off drops them all.
     * @param {boolean} enabled
     * @returns {void}
     */
    setEnabled(enabled) {
        if (enabled === this._isEnabled) {
            return;
        }
        this._isEnabled = enabled;
        this._applyVisibility();
        if (enabled) {
            this._isStale = true;
        } else {
            this._dirtyObjects.clear();
            this._badges.releaseAll();
        }
    }

    /**
     * Map mode keeps the overlay up, on bigger badges; the overworld hides it.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this._viewMode = mode;
        this._isMapMode = mode === ViewMode.MAP;
        this._applyVisibility();
        for (const badge of this._badges.values()) {
            this._applyBadgeScale(badge);
        }
    }

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheSet(entry) {
        if (this._isEnabled && entry.getProductFieldOrNull() !== null) {
            this._dirtyObjects.add(entry.id);
        }
    }

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheUpdate(entry) {
        if (this._isEnabled && entry.getProductFieldOrNull() !== null) {
            this._dirtyObjects.add(entry.id);
        }
    }

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheRemove(entry) {
        this._dirtyObjects.delete(entry.id);
        this._badges.release(entry.id);
    }

    /**
     * Rebuilds the dirty badges; hidden (the overworld), the backlog waits for the zoom back in.
     * @param {number} frame
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        if (!this.visible) {
            return;
        }
        if (this._isStale) {
            this._isStale = false;
            for (const entry of this.cache.values()) {
                if (entry.getProductFieldOrNull() !== null) {
                    this._dirtyObjects.add(entry.id);
                }
            }
        }
        for (const objectRef of this._dirtyObjects) {
            this._applyBadge(this.cache.get(objectRef));
        }
        this._dirtyObjects.clear();
    }

    /**
     * Places an object's badge on the item it produced last, dropping the badge of one that has
     * produced nothing; a badge already on that item is left alone.
     * @private
     * @param {CacheEntry} entry
     * @returns {void}
     */
    _applyBadge(entry) {
        const itemTypeId = entry.productItemTypeId;
        if (itemTypeId === EMPTY) {
            this._badges.release(entry.id);
            return;
        }
        const badge = this._badges.acquire(entry.id);
        if (badge.itemTypeId === itemTypeId) {
            return;
        }
        const definition = this._items.getItemTypeOrDefaultByTypeId(itemTypeId);
        badge.setItem(itemTypeId, this.textureCache.get(definition.texture), definition.tint);
        badge.footprintTiles = productBadgeFootprintTiles(entry.tileBounds);
        this._applyBadgeScale(badge);
        const center = entry.center;
        badge.position.set(center.x, center.y);
    }

    /**
     * Sizes a badge for its footprint and the zoom band it is drawn in.
     * @private
     * @param {ProductBadgeSprite} badge
     * @returns {void}
     */
    _applyBadgeScale(badge) {
        badge.scale.set(productBadgeScale(this._isMapMode, badge.footprintTiles));
    }

    /**
     * The shadow disc shared by every badge, rasterized on first use: the overlay is off until the
     * player asks for it.
     * @private
     * @returns {GraphicsContext}
     */
    _getShadowContext() {
        if (this._shadow === null) {
            this._shadow = new GraphicsContext().circle(0, 0, SHADOW_RADIUS).fill(new FillGradient({
                type: "radial",
                center: {x: 0.5, y: 0.5},
                innerRadius: 0,
                outerCenter: {x: 0.5, y: 0.5},
                outerRadius: 0.5,
                colorStops: [
                    {offset: 0, color: SHADOW_CENTER_COLOR},
                    {offset: 1, color: SHADOW_EDGE_COLOR},
                ],
            }));
        }
        return this._shadow;
    }

    /**
     * @private
     * @returns {void}
     */
    _applyVisibility() {
        this.visible = this._isEnabled && this._viewMode !== ViewMode.OVERWORLD;
    }
}

/**
 * One object's badge: the shared shadow disc with the produced item's icon centered on it.
 */
class ProductBadgeSprite extends Container {

    /**
     * @param {GraphicsContext} shadow
     */
    constructor(shadow) {
        super();
        // The item this badge shows, so a resync that leaves it alone rebuilds nothing.
        this.itemTypeId = EMPTY;
        // The longest side of the object this badge sits on, in tiles; the layer sizes it by this.
        this.footprintTiles = 1;
        this.addChild(new Graphics(shadow));
        /**
         * @type {Sprite}
         * @private
         */
        this._icon = new Sprite();
        this._icon.anchor.set(0.5);
        this.addChild(this._icon);
    }

    /**
     * @param {number} itemTypeId
     * @param {Texture} texture
     * @param {number} tint pixi multiply tint
     * @returns {void}
     */
    setItem(itemTypeId, texture, tint) {
        this.itemTypeId = itemTypeId;
        this._icon.texture = texture;
        this._icon.tint = tint;
        this._icon.scale.set(fitIconScale(texture, PRODUCT_ICON_SIZE));
    }
}
