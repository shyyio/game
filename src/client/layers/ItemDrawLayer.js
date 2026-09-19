import {Container, Graphics, Particle, ParticleContainer, Texture} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {DisplayPool} from "@/client/layers/DisplayPool.js";
import {KeyedDisplayPool} from "@/client/layers/KeyedDisplayPool.js";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction, NO_TICK} from "@/common/constants.js";
import {rotate} from "@/common/util.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import ReducedMotion from "@/client/ReducedMotion.js";

// Item sprites resting in output ports share this layer with lane items; their keys are
// namespaced from the lane item keys so the two can't collide.
export const PORT_SPRITE_KEY = portRef => `port:${portRef}`;

// Items glide to each new position over this long (the game tick is 600ms, so they
// arrive and briefly rest before the next move).
const MOVE_DURATION_MS = 190;

// World pixels an item rides above its tile: the belt carrying it stands 1 art pixel tall, drawn
// at 2x.
const ITEM_RIDE_HEIGHT = 2;

/**
 * The single shared item layer. Renders item particles keyed by id, with glide. Mods that
 * compute item positions (belts) drive it imperatively; resting items in render-flagged
 * output ports are driven here from the PORT_ITEM_SET/CLEAR events, with the render tile derived
 * from the shared object index and the owning object's PortDefinition.
 *
 * Items render as a ParticleContainer: gliding positions ride the per-frame dynamic buffer,
 * while texture/alpha changes and add/removes flag a static-buffer flush — so thousands of
 * moving items never re-pack a batch the way Sprite children would.
 */
export class ItemDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ItemRegistry} items item types merged across mods
     * @param {ClockView} clock the sim clock an item's age is read against
     */
    constructor(items, clock) {
        super();
        /**
         * @type {ClockView}
         * @private
         */
        this._clock = clock;
        /**
         * The particle view holding every item; all item textures share the one atlas source.
         * @type {ParticleContainer}
         * @private
         */
        this._particles = new ParticleContainer();
        this.addChild(this._particles);
        /**
         * Particles with a glide in flight; the only ones the per-frame tick advances.
         * @type {Set<ItemParticle>}
         * @private
         */
        this._gliding = new Set();
        /**
         * Consumed particles gliding out, detached from the key space and released on arrival.
         * @type {Set<ItemParticle>}
         * @private
         */
        this._dying = new Set();
        /**
         * The particle pool behind {@link _items}; also releases detached dying particles.
         * Idle particles await reuse parked in the container at alpha 0 and kept at the
         * high-water mark: pixi's removeParticle is a linear scan per call, so unload bursts
         * would go quadratic.
         * @type {DisplayPool}
         * @private
         */
        this._itemPool = new DisplayPool(
            texture => {
                const particle = new ItemParticle(texture, this._particles);
                this._particles.addParticle(particle);
                return particle;
            },
            particle => {
                particle.live = false;
                particle.setAlpha(0);
                this._gliding.delete(particle);
                this._dying.delete(particle);
                this._aging.delete(particle);
            },
            (particle, texture) => {
                // Parked particles are still attached; re-light in place.
                particle.setTexture(texture);
                particle.reset();
            },
        );
        /**
         * Live particles keyed by particle key — a number row id for belt items, a namespaced
         * string for items resting in output ports.
         * @type {KeyedDisplayPool}
         * @private
         */
        this._items = new KeyedDisplayPool(this._itemPool);
        /**
         * Item definitions merged across mods.
         * @type {ItemRegistry}
         * @private
         */
        this._itemRegistry = items;
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
        /**
         * Set when a move may have changed which items overlap which; the next tick re-sorts.
         * @type {boolean}
         * @private
         */
        this._isOrderStale = false;
        /**
         * Particles of an aging item type: the tick re-textures them as they age.
         * @type {Set<ItemParticle>}
         * @private
         */
        this._aging = new Set();
        /**
         * The clock the last age pass ran against; the pass is skipped until it moves.
         * @type {number}
         * @private
         */
        this._agedClock = NO_TICK;
    }

    get layerIndex() {
        // Above belts (10), below the mod overlays (100).
        return 15;
    }

    get eventClasses() {
        return [PortItemSetEvent, PortItemClearEvent];
    }

    /**
     * Renders or clears a resting output port item, deriving its tile from the object index;
     * ignores ports not in the index (a lane's output port, which LaneItemDrawLayer draws).
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        // A null placement means a port this layer doesn't own (a lane's output port, or a
        // port whose id isn't in the index): leave it to the owning layer.
        const placement = this._resolvePort(event.portRef);
        if (placement === null) {
            return;
        }
        if (event instanceof PortItemSetEvent) {
            this.moveItem({
                key: PORT_SPRITE_KEY(event.portRef),
                tileX: placement.tileX,
                tileY: placement.tileY,
                halfTile: true,
                sourceDirection: placement.sourceDirection,
                type: event.itemTypeId,
                birthTick: event.birthTick,
            });
        } else if (event.consumed === 1) {
            this.consumeItem(PORT_SPRITE_KEY(event.portRef), placement.sourceDirection);
        } else {
            this.removeItem(PORT_SPRITE_KEY(event.portRef));
        }
    }

    /**
     * The render tile for a port ref, derived from its owning object's cached position/direction
     * and the matching output PortDefinition (offset + facing rotated by the object). Null when
     * the port isn't in the object index (another mod's port, or not yet cached).
     * @param {number} portRef
     * @returns {{tileX: number, tileY: number, sourceDirection: Direction}|null}
     * @private
     */
    _resolvePort(portRef) {
        const entry = this.cache.getByPort(portRef);
        if (entry === null) {
            return null;
        }
        const portDef = entry.data.type.outputPorts.find(port => port.name === entry.portName(portRef));
        const world = rotate(portDef, entry.data.direction);
        return {
            tileX: entry.tileX + world.x,
            tileY: entry.tileY + world.y,
            sourceDirection: Direction.invert(world.direction),
        };
    }

    /**
     * Drops a removed object's resting output port item particles.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheRemove(entry) {
        for (const portRef of Object.values(entry.ports)) {
            this.removeItem(PORT_SPRITE_KEY(portRef));
        }
    }

    /**
     * Advances each item's glide toward its target by the frame's elapsed time.
     * @param {number} frame unused — items move, they don't cycle frames
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks unused — particles cull by chunk mount
     */
    tick(frame, deltaMS, visibleChunks) {
        this._applyAge();
        this._applyOrder();
        for (const particle of this._gliding) {
            particle.advance(deltaMS);
            if (!particle.gliding) {
                this._gliding.delete(particle);
                if (this._dying.delete(particle)) {
                    this._itemPool.release(particle);
                }
            }
        }
    }

    /**
     * Places or repositions an item at a belt tile, with the texture for its item type. A isHidden
     * item is still positioned, keeping its glide continuous.
     * @param {Object} move
     * @param {number|string} move.key - particle key (row id for belt items, namespaced string for output port items)
     * @param {number} move.tileX
     * @param {number} move.tileY
     * @param {boolean} move.halfTile
     * @param {Direction} move.sourceDirection - toward the parent belt (the input/bend edge)
     * @param {number} move.type - item type, selecting the texture
     * @param {boolean} [move.snap] - place at the target without animating (a re-sync)
     * @param {boolean} [move.isHidden] - the item is under cover (in a tunnel)
     */
    moveItem({key, tileX, tileY, halfTile, sourceDirection, type, birthTick=NO_TICK, snap=false, isHidden=false}) {
        const particle = this._acquireItem(key, type, birthTick, isHidden);
        // Reduced motion puts the item on its new tile outright, no glide.
        particle.moveTo(tileX, tileY, halfTile, sourceDirection, snap || ReducedMotion.isEnabled);
        if (particle.gliding) {
            this._gliding.add(particle);
        }
    }

    /**
     * The live particle under a key, lit with an item type's texture and tint and ready to be
     * aimed; a move sets it stale so the next tick re-sorts.
     * @private
     * @param {number|string} key
     * @param {number} type - item type, selecting the texture
     * @param {number} birthTick - the tick the item was made on
     * @param {boolean} isHidden - the item is under cover (in a tunnel)
     * @returns {ItemParticle}
     */
    _acquireItem(key, type, birthTick, isHidden) {
        const definition = this._itemRegistry.getItemTypeOrDefaultByTypeId(type);
        const texture = this.textureCache.get(this._getTextureName(definition, birthTick));
        this._isOrderStale = true;
        const particle = this._items.acquire(key, texture);
        particle.live = true;
        particle.itemTypeId = type;
        particle.birthTick = birthTick;
        particle.setTexture(texture);
        particle.setTint(definition.tint);
        particle.isHidden = isHidden;
        if (definition.isAging) {
            this._aging.add(particle);
        } else {
            this._aging.delete(particle);
        }
        this._applyItemVisibility(particle);
        return particle;
    }

    /**
     * The texture an item type shows for an item born on `birthTick`.
     * @private
     * @param {ItemType} definition
     * @param {number} birthTick
     * @returns {string} texture name
     */
    _getTextureName(definition, birthTick) {
        if (!definition.isAging) {
            return definition.texture;
        }
        return definition.getTextureByAge(this._clock.tick() - birthTick);
    }

    /**
     * Re-textures the aging items against the clock, and drops the ones that have reached their
     * last frame. The clock moves once a sim tick, so a frame that shares one does no work.
     * @private
     * @returns {void}
     */
    _applyAge() {
        const clock = this._clock.tick();
        if (clock === this._agedClock) {
            return;
        }
        this._agedClock = clock;
        for (const particle of this._aging) {
            const definition = this._itemRegistry.getItemTypeOrDefaultByTypeId(particle.itemTypeId);
            const age = clock - particle.birthTick;
            particle.setTexture(this.textureCache.get(definition.getTextureByAge(age)));
            if (definition.isFullyAged(age)) {
                this._aging.delete(particle);
            }
        }
    }

    /**
     * Applies an item's isHidden state: isHidden items render at alpha 0, except at 0.7 in debug mode.
     * @param {ItemParticle} particle
     * @private
     */
    _applyItemVisibility(particle) {
        let alpha = 1;
        if (particle.isHidden) {
            alpha = this._debugMasks ? 0.7 : 0;
        }
        particle.setAlpha(alpha);
    }

    /**
     * The visible item nearest a world point, within `reach` of it on both axes; null if none is.
     * Picking by point, not by tile, so half-tile items straddling a tile edge are pickable.
     * @param {number} x - world pixels
     * @param {number} y - world pixels
     * @param {number} reach - world pixels from the point an item's center may sit
     * @returns {ItemParticle|null}
     */
    getItemAtOrNull(x, y, reach) {
        let nearest = null;
        let nearestDistance = 0;
        for (const particle of this._items.values()) {
            if (!particle.pickable) {
                continue;
            }
            const dx = Math.abs(particle.x - x);
            const dy = Math.abs(particle.y - y);
            if (dx > reach || dy > reach) {
                continue;
            }
            const distance = dx + dy;
            if (nearest === null || distance < nearestDistance) {
                nearest = particle;
                nearestDistance = distance;
            }
        }
        return nearest;
    }

    /**
     * Places or repositions an item along a lane's path.
     * @param {Object} move
     * @param {number|string} move.key - particle key
     * @param {LanePath} move.path - the lane's path
     * @param {number} move.distance - world pixels from the lane's input edge
     * @param {number} move.entryDistance - the slot behind it, where a fresh sprite glides in from
     * @param {number} move.type - item type, selecting the texture
     * @param {boolean} [move.snap] - place at the target without animating (a re-sync)
     * @param {boolean} [move.isHidden] - the item is under cover (in a tunnel)
     */
    moveItemAlong({key, path, distance, entryDistance, type, birthTick=NO_TICK, snap=false, isHidden=false}) {
        const particle = this._acquireItem(key, type, birthTick, isHidden);
        particle.moveAlong(path, distance, entryDistance, snap || ReducedMotion.isEnabled);
        if (particle.gliding) {
            this._gliding.add(particle);
        }
    }

    /**
     * Sorts the particles top to bottom, so a lower item draws over a higher one and overlaps
     * read as depth. Ranked on where a move aimed each item, not where its glide currently has
     * it, so the order settles once a tick rather than every frame.
     * @private
     * @returns {void}
     */
    _applyOrder() {
        if (!this._isOrderStale) {
            return;
        }
        this._isOrderStale = false;
        this._particles.particleChildren.sort((a, b) => a.sortOrder - b.sortOrder);
        this._particles.update();
    }

    /**
     * Whether a live item holds the key.
     * @param {number|string} key
     * @returns {boolean}
     */
    hasItem(key) {
        return this._items.has(key);
    }

    /**
     * Glides a consumed item a half-tile on into the consumer, then drops it; the key frees
     * immediately, so the port's next item can take it while the exit plays out.
     * @param {number|string} key
     * @param {Direction} sourceDirection - toward the parent belt/port (as in moveItem)
     * @returns {void}
     */
    consumeItem(key, sourceDirection) {
        const particle = this._items.get(key);
        if (particle === undefined) {
            return;
        }
        if (ReducedMotion.isEnabled || particle.isHidden) {
            this.removeItem(key);
            return;
        }
        this._items.detach(key);
        this._aging.delete(particle);
        particle.consumeAlong(Direction.invert(sourceDirection));
        this._gliding.add(particle);
        this._dying.add(particle);
    }

    /**
     * Drops an item; a no-op for an unknown key.
     * @param {number|string} key
     */
    removeItem(key) {
        // A released particle is parked in place at alpha 0, so the order of what remains holds.
        this._items.release(key);
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
     * Debug mode shows the occluders and isHidden items semi-transparent instead of masking.
     * @param {boolean} enabled
     * @returns {void}
     */
    setDebugMode(enabled) {
        this._debugMasks = enabled;
        for (const particle of this._items.values()) {
            this._applyItemVisibility(particle);
        }
        this._applyMask();
    }
}

class ItemParticle extends Particle {

    /**
     * @param {Texture} texture
     * @param {ParticleContainer} container the container whose static buffer this particle rides
     */
    constructor(texture, container) {
        super({texture, anchorX: 0.5, anchorY: 0.5});
        this._container = container;
        // The item type on show, so a picked particle can be named.
        this.itemTypeId = null;
        // The tick the item was made on, which its age is read against.
        this.birthTick = NO_TICK;
        // False once released to the pool.
        this.live = false;
        // Under cover (in a tunnel): positioned but rendered at alpha 0 outside debug mode.
        this.isHidden = false;
        // Glide state: start/target pixels and ms elapsed into the current move.
        // _startX is null when not gliding (freshly placed or arrived).
        this._startX = null;
        this._startY = null;
        this._targetX = null;
        this._targetY = null;
        this._elapsed = 0;
        // The lane ridden, when riding one: the glide then runs along its path instead of in a
        // straight line, so a bend curves.
        /** @type {LanePath|null} */
        this._path = null;
        this._startDistance = null;
        this._targetDistance = null;
        this._distance = 0;
        // Draw depth: the world y this item's current move aims at.
        this.sortOrder = 0;
    }

    /**
     * Whether the item can be picked out of the world: on show, and not under cover.
     * @returns {boolean}
     */
    get pickable() {
        return this.live && !this.isHidden;
    }

    /**
     * @returns {boolean}
     */
    get gliding() {
        return this._startX !== null || this._startDistance !== null;
    }

    /**
     * Swaps the texture; a static (uv) particle property, so a change flags the container flush.
     * @param {Texture} texture
     * @returns {void}
     */
    setTexture(texture) {
        if (this.texture === texture) {
            return;
        }
        this.texture = texture;
        this._container.update();
    }

    /**
     * Sets the tint; a static (uv) particle property, so a change flags the container flush.
     * @param {number} tint
     * @returns {void}
     */
    setTint(tint) {
        if (this.tint === tint) {
            return;
        }
        this.tint = tint;
        this._container.update();
    }

    /**
     * Sets the alpha; a static particle property, so a change flags the container flush.
     * @param {number} alpha
     * @returns {void}
     */
    setAlpha(alpha) {
        if (this.alpha === alpha) {
            return;
        }
        this.alpha = alpha;
        this._container.update();
    }

    /**
     * Clears glide and cover state for reuse from the pool.
     * @returns {void}
     */
    reset() {
        this.itemTypeId = null;
        this.birthTick = NO_TICK;
        this.isHidden = false;
        this._clearPath();
        this._distance = 0;
        this.sortOrder = 0;
        this._startX = null;
        this._startY = null;
        this._targetX = null;
        this._targetY = null;
        this._elapsed = 0;
    }

    /**
     * Aims the item at a belt tile. When straddling (half-tile) it sits a half-tile
     * toward `sourceDirection` — the parent belt — so on a bend it lands on the
     * input edge, not simply opposite the flow. A new item glides in from a further
     * half-tile that way; later moves glide from the item's current position.
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} halfTile
     * @param {Direction} sourceDirection - toward the source (parent) belt
     * @param {boolean} [snap] - jump straight to the target without gliding (a re-sync: the
     *     item was re-keyed in place, not moved, so animating it would look like motion)
     */
    moveTo(tileX, tileY, halfTile, sourceDirection, snap=false) {
        this._clearPath();
        const half = TILE_SIZE / 2;
        const sdx = Direction.dx(sourceDirection);
        const sdy = Direction.dy(sourceDirection);
        let offsetX = 0;
        let offsetY = 0;
        if (halfTile) {
            offsetX = sdx * half;
            offsetY = sdy * half;
        }
        const targetX = tileX * TILE_SIZE + half + offsetX;
        const targetY = tileY * TILE_SIZE + half + offsetY - ITEM_RIDE_HEIGHT;
        this.sortOrder = targetY;
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
            // New target: glide from wherever the item currently is (picking up any
            // glide still in flight).
            this._startX = this.x;
            this._startY = this.y;
            this._elapsed = 0;
        }
        this._targetX = targetX;
        this._targetY = targetY;
    }

    /**
     * Aims the item at a distance along a lane's path. A new item glides in from the slot behind
     * its target, so it picks up where the sprite it replaces left off; later moves glide from
     * where it currently stands.
     * @param {LanePath} path
     * @param {number} distance - world pixels from the lane's input edge
     * @param {number} entryDistance - the slot behind the target
     * @param {boolean} [snap] - jump straight to the target without gliding (a re-sync)
     * @returns {void}
     */
    moveAlong(path, distance, entryDistance, snap=false) {
        const isSamePath = this._path === path;
        this._path = path;
        this._startX = null;
        this._targetX = null;
        const target = path.getPointByDistance(distance);
        this.sortOrder = target.y - ITEM_RIDE_HEIGHT;
        if (snap) {
            this._startDistance = null;
            this._targetDistance = distance;
            this._distance = distance;
            this.x = target.x;
            this.y = target.y - ITEM_RIDE_HEIGHT;
            return;
        }
        if (!isSamePath || this._targetDistance === null) {
            // First placement on this lane: start on the slot behind so it slides in along the
            // flow. A bend's stretch is shorter than a tile, so a fixed step would start behind it.
            this._startDistance = entryDistance;
            this._targetDistance = distance;
            this._elapsed = 0;
            this._applyDistance(this._startDistance);
            return;
        }
        if (distance !== this._targetDistance) {
            this._startDistance = this._distance;
            this._targetDistance = distance;
            this._elapsed = 0;
        }
    }

    /**
     * Leaves path mode, so the next advance lerps in a straight line.
     * @private
     * @returns {void}
     */
    _clearPath() {
        this._path = null;
        this._startDistance = null;
        this._targetDistance = null;
    }

    /**
     * Puts the sprite on the point a distance along its path.
     * @private
     * @param {number} distance
     * @returns {void}
     */
    _applyDistance(distance) {
        this._distance = distance;
        const point = this._path.getPointByDistance(distance);
        this.x = point.x;
        this.y = point.y - ITEM_RIDE_HEIGHT;
    }

    /**
     * Starts the consumed glide: from the current position a half-tile along `direction`.
     * @param {Direction} direction - the travel direction into the consumer
     * @returns {void}
     */
    consumeAlong(direction) {
        const half = TILE_SIZE / 2;
        this._clearPath();
        this._startX = this.x;
        this._startY = this.y;
        this._targetX = this.x + Direction.dx(direction) * half;
        this._targetY = this.y + Direction.dy(direction) * half;
        this._elapsed = 0;
    }

    /**
     * Advances an in-flight glide toward the target; a no-op once arrived or unplaced.
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     */
    advance(deltaMS) {
        if (this._startDistance !== null) {
            this._advanceAlongPath(deltaMS);
            return;
        }
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

    /**
     * Advances a glide that rides a lane's path: the distance lerps, the point comes off the
     * path, so a bend carries the item round its arc.
     * @private
     * @param {number} deltaMS
     * @returns {void}
     */
    _advanceAlongPath(deltaMS) {
        this._elapsed += deltaMS;
        if (this._elapsed >= MOVE_DURATION_MS) {
            this._applyDistance(this._targetDistance);
            this._startDistance = null;
            return;
        }
        const t = this._elapsed / MOVE_DURATION_MS;
        this._applyDistance(this._startDistance + t * (this._targetDistance - this._startDistance));
    }
}
