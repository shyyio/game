import {Sprite, Texture, TILE_SIZE, AbstractDrawLayer, OCCUPANCY_LAYER_SURFACE} from "@/sdk/client.js";
import {OccupantKind} from "./constants.js";
import {splitterConnections, inferBeltParent} from "./geometry.js";

// An animated half-belt stub bridging a splitter port to whatever it connects to.
class ConnectionSprite extends Sprite {

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} angle - sprite rotation in degrees
     * @param {Texture[]|undefined} frames - ordered animation frames
     */
    constructor(x, y, angle, frames) {
        super(Texture.EMPTY);
        this.anchor = 0.5;
        this.angle = angle;
        this.frames = frames;
        this.position.set(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
    }

    /**
     * Shows the given frame, wrapping modulo the sequence length.
     * @param {number} frame animation frame, in [0, 8)
     */
    setAnimationFrame(frame) {
        if (this.frames === undefined || this.frames.length === 0) {
            this.texture = Texture.EMPTY;
            return;
        }
        this.texture = this.frames[frame % this.frames.length];
    }
}

/**
 * Draws an animated connection stub at each splitter port whose neighbouring tile is occupied,
 * derived each frame from the splitter cache and the shared occupancy index — so it tracks
 * belts/splitters added or removed around a splitter with no extra event plumbing.
 */
export class SplitterConnectionLayer extends AbstractDrawLayer {

    constructor() {
        super();
        // Composite "splitterId:portKey" → sprite.
        this._sprites = new Map();
        this._lowRes = false;
    }

    get layerIndex() {
        // Above belts (10) but below belt items (15), so items ride over the connection stubs.
        return 14;
    }

    /**
     * No-op: connections are derived per frame in tick, not event-driven.
     * @param {AbstractEvent} event
     */
    onEvent(event) {}

    /**
     * Hidden in map mode (the stubs are sprite-only detail).
     * @param {boolean} value
     */
    set lowRes(value) {
        this._lowRes = value;
        this.visible = !value;
    }

    /**
     * Recomputes which connections are present, adds/removes sprites for the delta, then
     * advances every live stub to the shared animation frame.
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        if (this._lowRes || this.cache === null || this.textureRegistry === null) {
            return;
        }
        const desired = this._desiredConnections();
        this._sprites.forEach((sprite, key) => {
            if (!desired.has(key)) {
                sprite.destroy();
                this.removeChild(sprite);
                this._sprites.delete(key);
            }
        });
        desired.forEach((spec, key) => {
            if (!this._sprites.has(key)) {
                const sprite = new ConnectionSprite(
                    spec.tileX,
                    spec.tileY,
                    spec.angle,
                    this.textureRegistry.getAnimation(spec.base),
                );
                this.addChild(sprite);
                this._sprites.set(key, sprite);
            }
        });
        this._sprites.forEach(sprite => {
            sprite.setAnimationFrame(frame);
        });
    }

    /**
     * The connection stub each cached splitter should show this frame, keyed by
     * "splitterId:portKey": a port that actually shares its seam with a neighbor, inferred
     * the same way belts pick their parent (so a belt that bends in/out still connects).
     * @returns {Map<string, {base: string, tileX: number, tileY: number, angle: number}>}
     * @private
     */
    _desiredConnections() {
        const desired = new Map();
        this.cache.values().forEach(record => {
            if (record.data.kind !== OccupantKind.SPLITTER) {
                return;
            }
            const direction = record.data.direction;
            splitterConnections(record.tileX, record.tileY, direction).forEach(spec => {
                if (this._connected(spec, direction)) {
                    desired.set(`${record.id}:${spec.key}`, {
                        base: spec.base,
                        tileX: spec.tileX,
                        tileY: spec.tileY,
                        angle: spec.angle,
                    });
                }
            });
        });
        return desired;
    }

    /**
     * Whether a splitter port shares a seam with a neighbour. An output port connects when the
     * downstream object is fed from this cell; an input port connects when something feeds this
     * cell — both decided by the shared belt-parent inference.
     * @param {object} spec - a splitterConnections entry
     * @param {Direction} splitterDirection
     * @returns {boolean}
     * @private
     */
    _connected(spec, splitterDirection) {
        if (spec.isOutput) {
            const downstream = this.cache.at(spec.neighborX, spec.neighborY, OCCUPANCY_LAYER_SURFACE);
            if (downstream === null) {
                return false;
            }
            const parent = inferBeltParent(this.cache, spec.neighborX, spec.neighborY, downstream.data.direction);
            return parent.parentX === spec.tileX && parent.parentY === spec.tileY;
        }
        const parent = inferBeltParent(this.cache, spec.tileX, spec.tileY, splitterDirection);
        return parent.parentX !== null;
    }
}
