import {Container, Graphics, Sprite, Texture} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";
import {rotate} from "@/common/util.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";

// Item sprites resting in out-ports share this layer with belt-path items; their keys are
// namespaced from the path-item row-id keys so the two can't collide.
export const PORT_SPRITE_KEY = portId => `port:${portId}`;

// Texture for an item type with no mod-supplied mapping.
export const DEFAULT_ITEM_TEXTURE = "items/3";

// Items glide to each new position over this long (the game tick is 600ms, so they
// arrive and briefly rest before the next move).
const MOVE_DURATION_MS = 190;

/**
 * The single shared item layer. Renders item sprites keyed by id, with glide. Mods that
 * compute item positions (belts) drive it imperatively; resting items in render-flagged
 * out-ports are driven here from the PORT_ITEM_SET/CLEAR events, with the render tile derived
 * from the shared object index and the owning object's PortDefinition.
 */
export class ItemDrawLayer extends AbstractDrawLayer {

    /**
     * @param {Object.<number, string>} itemTextures item type -> texture name, merged across mods
     */
    constructor(itemTextures) {
        super();
        /**
         * Live sprites, keyed by sprite key — a number row id for belt items, a
         * namespaced string for items resting in out-ports.
         * @type {Object.<string, ItemSprite>}
         * @private
         */
        this._items = {};
        /**
         * Item type -> texture name, merged across mods.
         * @type {Object.<number, string>}
         * @private
         */
        this._itemTextures = itemTextures;
        /**
         * Occluder graphics, keyed by caller-chosen key (owner id + role); this layer's
         * inverse mask, hiding items beneath.
         * @type {Object.<string, Graphics>}
         * @private
         */
        this._masks = {};
        /**
         * The occluder graphics, applied as this layer's inverse alpha mask.
         * @type {Container}
         * @private
         */
        // A child so it shares the camera transform; kept out of the normal draw except debug.
        this._maskContainer = new Container();
        this._maskContainer.renderable = false;
        this._maskContainer.includeInBuild = false;
        this.addChild(this._maskContainer);

        /**
         * Whether debug mode shows the occluders instead of masking with them.
         * @type {boolean}
         * @private
         */
        this._debugMasks = false;
    }

    get layerIndex() {
        // Above belts (10), below the debug path overlay (100).
        return 15;
    }

    /**
     * Hides items in map mode.
     * @param {boolean} value
     */
    set mapMode(value) {
        this.visible = !value;
    }

    /**
     * Renders or clears a resting out-port item, deriving its tile from the object index;
     * ignores ports not in the index (e.g. belt-path ports, which the Logistics mod drives).
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (!(event instanceof PortItemSetEvent) && !(event instanceof PortItemClearEvent)) {
            return;
        }
        // A null placement means a port this layer doesn't own (a belt-path port, or a
        // port whose id isn't in the index) — leave it to the owning mod.
        const placement = this._resolvePort(event.portId);
        if (placement === null) {
            return;
        }
        if (event instanceof PortItemSetEvent) {
            this.moveItem(PORT_SPRITE_KEY(event.portId), placement.tileX, placement.tileY, true, placement.sourceDir, event.itemType);
        } else {
            this.removeItem(PORT_SPRITE_KEY(event.portId));
        }
    }

    /**
     * The render tile for a port id, derived from its owning object's cached position/direction
     * and the matching output PortDefinition (offset + facing rotated by the object). Null when
     * the port isn't in the object index (another mod's port, or not yet cached).
     * @param {number} portId
     * @returns {{tileX: number, tileY: number, sourceDir: Direction}|null}
     * @private
     */
    _resolvePort(portId) {
        const entry = this.cache.getByPort(portId);
        if (entry === null) {
            return null;
        }
        const portDef = entry.data.definition.outputPorts.find(port => port.name === entry.portName(portId));
        const world = rotate(portDef, entry.data.direction);
        return {
            tileX: entry.tileX + world.x,
            tileY: entry.tileY + world.y,
            sourceDir: Direction.invert(world.direction),
        };
    }

    /**
     * Drops the resting item sprites of a removed object (driven by the cache's removal hook).
     * @param {CacheEntry} entry - the removed cache entry
     * @returns {void}
     */
    dropPorts(entry) {
        Object.values(entry.ports).forEach(portId => {
            this.removeItem(PORT_SPRITE_KEY(portId));
        });
    }

    /**
     * Advances each item's glide toward its target by the frame's elapsed time.
     * @param {number} frame unused — items move, they don't cycle frames
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     */
    tick(frame, deltaMS) {
        Object.values(this._items).forEach(sprite => sprite.advance(deltaMS));
    }

    /**
     * Places or repositions a sprite at a belt tile and half-tile offset, with the texture for
     * its item type. A hidden item is still positioned, keeping its glide continuous.
     * @param {number|string} key - sprite key (row id for belt items, namespaced string for out-port items)
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} halfTile
     * @param {Direction} sourceDir - toward the belt feeding this one (the input/bend edge)
     * @param {number} type - item type, selecting the sprite texture
     * @param {boolean} [snap] - place at the target without animating (a re-sync)
     * @param {boolean} [hidden] - the item is under cover (in a tunnel)
     */
    moveItem(key, tileX, tileY, halfTile, sourceDir, type, snap=false, hidden=false) {
        const texture = this._textureForType(type);
        let sprite = this._items[key];
        if (sprite === undefined) {
            sprite = new ItemSprite(texture);
            this.addChild(sprite);
            this._items[key] = sprite;
        } else if (sprite.texture !== texture) {
            // The port now rests a different item type: swap the sprite's texture in place.
            sprite.texture = texture;
        }
        sprite.hidden = hidden;
        this._applyItemVisibility(sprite);
        sprite.moveTo(tileX, tileY, halfTile, sourceDir, snap);
    }

    /**
     * Applies a sprite's hidden state: hidden items don't render, except at half alpha
     * in debug mode.
     * @param {ItemSprite} sprite
     * @private
     */
    _applyItemVisibility(sprite) {
        if (!sprite.hidden) {
            sprite.visible = true;
            sprite.alpha = 1;
        } else if (this._debugMasks) {
            sprite.visible = true;
            sprite.alpha = 0.7;
        } else {
            sprite.visible = false;
            sprite.alpha = 1;
        }
    }

    /**
     * The texture for an item type, or the default for an unmapped type.
     * @param {number} type
     * @returns {Texture}
     * @private
     */
    _textureForType(type) {
        const name = this._itemTextures[type] !== undefined ? this._itemTextures[type] : DEFAULT_ITEM_TEXTURE;
        return this.textureRegistry.get(name);
    }

    /**
     * Re-keys a live sprite, preserving it (and its in-flight glide) so a moved item can
     * keep gliding under a new identity — e.g. a belt item popping into an out-port.
     * Drops whatever sprite already held the new key (the previous occupant). No-op for an
     * unknown source key.
     * @param {number|string} oldKey
     * @param {number|string} newKey
     */
    renameItem(oldKey, newKey) {
        const sprite = this._items[oldKey];
        if (sprite === undefined) {
            return;
        }
        const existing = this._items[newKey];
        if (existing !== undefined && existing !== sprite) {
            existing.destroy();
            this.removeChild(existing);
        }
        delete this._items[oldKey];
        this._items[newKey] = sprite;
    }

    /**
     * Drops a sprite; a no-op for an unknown key.
     * @param {number|string} key
     */
    removeItem(key) {
        const sprite = this._items[key];
        if (sprite === undefined) {
            return;
        }
        sprite.destroy();
        this.removeChild(sprite);
        delete this._items[key];
    }

    /**
     * Adds a rectangular occluder at a tile so items hide where it covers.
     * @param {string} key - caller-chosen key (owner id + role), used to remove it later
     * @param {number} tileX
     * @param {number} tileY
     * @param {Rectangle} rect - occluder in tile-local pixels
     * @param {Direction} direction - the owning object's facing; rotates the mask with it
     */
    addMask(key, tileX, tileY, rect, direction) {
        this.removeMask(key);
        const graphics = new Graphics()
            .rect(rect.x, rect.y, rect.width, rect.height)
            .fill(0x000000);
        // Pivot on the tile center so the facing rotation turns the rect about the tile.
        graphics.pivot.set(TILE_SIZE / 2, TILE_SIZE / 2);
        graphics.angle = Direction.angle(direction);
        graphics.position.set(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + TILE_SIZE / 2);
        this._masks[key] = graphics;
        this._maskContainer.addChild(graphics);
        this._applyMask();
    }

    /**
     * Drops the occluder under a key; a no-op for an unknown key.
     * @param {string} key
     */
    removeMask(key) {
        const graphics = this._masks[key];
        if (graphics === undefined) {
            return;
        }
        this._maskContainer.removeChild(graphics);
        graphics.destroy();
        delete this._masks[key];
        this._applyMask();
    }

    /**
     * Applies the occluder container as this layer's inverse alpha mask; in debug mode shows
     * the occluders instead.
     * @private
     */
    _applyMask() {
        this.mask = null;
        if (this._debugMasks) {
            this._maskContainer.renderable = true;
            this._maskContainer.includeInBuild = true;
            this._maskContainer.alpha = 0.6;
            return;
        }
        this._maskContainer.alpha = 1;
        if (this._maskContainer.children.length === 0) {
            this._maskContainer.renderable = false;
            this._maskContainer.includeInBuild = false;
            return;
        }
        // pixi only renders the mask (and thus occludes) when the container is built/renderable.
        this._maskContainer.renderable = true;
        this._maskContainer.includeInBuild = true;
        this.setMask({mask: this._maskContainer, inverse: true, channel: "alpha"});
    }

    /**
     * Debug mode shows the occluders and hidden items semi-transparent instead of masking.
     * @param {boolean} enabled
     * @returns {void}
     */
    setDebugMode(enabled) {
        this._debugMasks = enabled;
        Object.values(this._items).forEach(sprite => this._applyItemVisibility(sprite));
        this._applyMask();
    }
}

class ItemSprite extends Sprite {

    /**
     * @param {Texture} texture
     */
    constructor(texture) {
        super(texture === undefined ? Texture.EMPTY : texture);
        this.anchor = 0.5;
        // Under cover (in a tunnel): positioned but not rendered outside debug mode.
        this.hidden = false;
        // Glide state: start/target pixels and ms elapsed into the current move.
        // _startX is null when not gliding (freshly placed or arrived).
        this._startX = null;
        this._startY = null;
        this._targetX = null;
        this._targetY = null;
        this._elapsed = 0;
    }

    /**
     * Aims the sprite at a belt tile. When straddling (half-tile) it sits a half-tile
     * toward `sourceDir` — the belt feeding this one — so on a bend it lands on the
     * input edge, not simply opposite the flow. A new item glides in from a further
     * half-tile that way; later moves glide from the sprite's current position.
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} halfTile
     * @param {Direction} sourceDir - toward the source (parent) belt
     * @param {boolean} [snap] - jump straight to the target without gliding (a re-sync: the
     *     item was re-keyed in place, not moved, so animating it would look like motion)
     */
    moveTo(tileX, tileY, halfTile, sourceDir, snap=false) {
        const half = TILE_SIZE / 2;
        const sdx = Direction.dx(sourceDir);
        const sdy = Direction.dy(sourceDir);
        const targetX = tileX * TILE_SIZE + half + (halfTile ? sdx * half : 0);
        const targetY = tileY * TILE_SIZE + half + (halfTile ? sdy * half : 0);
        if (snap) {
            this.x = targetX;
            this.y = targetY;
            this._startX = null;
            this._targetX = targetX;
            this._targetY = targetY;
            return;
        }
        if (this._targetX === null) {
            // First placement of a new item entering the belt: start a half-tile further
            // toward the source so it slides in along the flow. (A re-sync snaps instead.)
            this.x = targetX + sdx * half;
            this.y = targetY + sdy * half;
            this._startX = this.x;
            this._startY = this.y;
            this._elapsed = 0;
        } else if (targetX !== this._targetX || targetY !== this._targetY) {
            // New target: glide from wherever the sprite currently is (picking up any
            // glide still in flight).
            this._startX = this.x;
            this._startY = this.y;
            this._elapsed = 0;
        }
        this._targetX = targetX;
        this._targetY = targetY;
    }

    /**
     * Advances an in-flight glide toward the target; a no-op once arrived or unplaced.
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     */
    advance(deltaMS) {
        if (this._startX === null) {
            return;
        }
        this._elapsed += deltaMS;
        if (this._elapsed >= MOVE_DURATION_MS) {
            this.x = this._targetX;
            this.y = this._targetY;
            this._startX = null;
            return;
        }
        const t = this._elapsed / MOVE_DURATION_MS;
        this.x = this._startX + t * (this._targetX - this._startX);
        this.y = this._startY + t * (this._targetY - this._startY);
    }
}
