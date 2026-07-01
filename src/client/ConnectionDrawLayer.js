import {Sprite, Texture} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

// Output (front) and input (back) connection stubs, rotated by the object's facing.
const OUTPUT_CONNECTION = "machine-connection-top-up";
const INPUT_CONNECTION = "machine-connection-bottom-up";

// An animated half-belt stub bridging a port to whatever it connects to.
class ConnectionSprite extends Sprite {

    /**
     * @param {number} x - tile the stub draws on
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
 * The single shared connection layer: draws an animated stub at each connected port of every cached
 * object whose definition opts in (`renderConnections`), derived each frame from the cache's
 * port-connection queries — so it tracks neighbors added or removed with no extra event plumbing.
 */
export class ConnectionDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        // Composite "objectId:portKey" → sprite.
        this._sprites = new Map();
        this._mapMode = false;
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
    set mapMode(value) {
        this._mapMode = value;
        this.visible = !value;
    }

    /**
     * Recomputes which connections are present, adds/removes sprites for the delta, then
     * advances every live stub to the shared animation frame.
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        if (this._mapMode || this.cache === null || this.textureRegistry === null) {
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
     * The connection stub each opted-in cached object should show this frame, keyed by "objectId:port".
     * @returns {Map<string, {base: string, tileX: number, tileY: number, angle: number}>}
     * @private
     */
    _desiredConnections() {
        const desired = new Map();
        this.cache.values().forEach(entry => {
            if (!entry.data.definition.renderConnections) {
                return;
            }
            const angle = Direction.angle(entry.data.direction);
            this.cache.connectedPorts(entry).forEach(connection => {
                desired.set(`${entry.id}:${connection.key}`, {
                    base: connection.isOutput ? OUTPUT_CONNECTION : INPUT_CONNECTION,
                    tileX: connection.tileX,
                    tileY: connection.tileY,
                    angle,
                });
            });
        });
        return desired;
    }
}
