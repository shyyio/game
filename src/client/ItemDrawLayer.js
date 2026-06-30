import {Sprite, Texture} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction, BUFFERED_EVENT_TYPE_PORT_ITEM_SET, BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR} from "@/common/constants.js";
import {rotate} from "@/common/util.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";

// Item sprites resting in out-ports share this layer with belt-path items; their keys are
// namespaced from the path-item row-id keys so the two can't collide.
export const PORT_SPRITE_KEY = portId => `port:${portId}`;

// Texture for an item type with no mod-supplied mapping.
const DEFAULT_ITEM_TEXTURE = "items/3";

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

    constructor() {
        super();
        /**
         * Live sprites, keyed by sprite key — a BigInt row id for belt items, a
         * namespaced string for items resting in out-ports.
         * @type {Object.<string, ItemSprite>}
         * @private
         */
        this._items = {};
        // Item type -> texture name, merged across mods and injected by Client.
        this.itemTextures = {};
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
     * ignores ports not in the index (e.g. belt-path ports, which the belt mod drives).
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (!(event instanceof BufferedEvent)) {
            return;
        }
        // A null placement means a port this layer doesn't own (a belt-path port, or a
        // non-port event whose id isn't in the index) — leave it to the owning mod.
        const placement = this._resolvePort(event.id);
        if (placement === null) {
            return;
        }
        if (event.type === BUFFERED_EVENT_TYPE_PORT_ITEM_SET) {
            this.moveItem(PORT_SPRITE_KEY(event.id), placement.tileX, placement.tileY, true, placement.sourceDir, Number(event.a));
        } else if (event.type === BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR) {
            this.removeItem(PORT_SPRITE_KEY(event.id));
        }
    }

    /**
     * The render tile for a port id, derived from its owning object's cached position/direction
     * and the matching output PortDefinition (offset + facing rotated by the object). Null when
     * the port isn't in the object index (another mod's port, or not yet cached).
     * @param {BigInt} portId
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
     * its item type.
     * @param {BigInt|string} key - sprite key (row id for belt items, namespaced string for out-port items)
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} halfTile
     * @param {Direction} sourceDir - toward the belt feeding this one (the input/bend edge)
     * @param {number} type - item type, selecting the sprite texture
     * @param {boolean} [snap] - place at the target without animating (a re-sync)
     */
    moveItem(key, tileX, tileY, halfTile, sourceDir, type, snap=false) {
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
        sprite.moveTo(tileX, tileY, halfTile, sourceDir, snap);
    }

    /**
     * The texture for an item type, or the default for an unmapped type.
     * @param {number} type
     * @returns {Texture}
     * @private
     */
    _textureForType(type) {
        const name = this.itemTextures[type] !== undefined ? this.itemTextures[type] : DEFAULT_ITEM_TEXTURE;
        return this.textureRegistry.get(name);
    }

    /**
     * Re-keys a live sprite, preserving it (and its in-flight glide) so a moved item can
     * keep gliding under a new identity — e.g. a belt item popping into an out-port.
     * Drops whatever sprite already held the new key (the previous occupant). No-op for an
     * unknown source key.
     * @param {BigInt|string} oldKey
     * @param {BigInt|string} newKey
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
     * @param {BigInt|string} key
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
}

class ItemSprite extends Sprite {

    /**
     * @param {Texture} texture
     */
    constructor(texture) {
        super(texture === undefined ? Texture.EMPTY : texture);
        this.anchor = 0.5;
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
