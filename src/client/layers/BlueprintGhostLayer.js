import {Container} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {ObjectSprite} from "@/client/layers/ObjectSprite.js";
import {ObjectsView} from "@/client/state/ObjectsState.js";
import Mouse from "@/client/input/Mouse.js";
import Keyboard from "@/client/input/Keyboard.js";
import {TILE_SIZE} from "@/client/constants.js";
import {GHOST_TINT, GHOST_ALPHA, GHOST_BLOCKED_TINT, GHOST_BLOCKED_ALPHA} from "@/client/Theme.js";

/** @typedef {number} GhostEntryState */
export const GHOST_ENTRY_STATE_CLEAR = 0;
export const GHOST_ENTRY_STATE_BLOCKED = 1;
export const GHOST_ENTRY_STATE_SKIPPED = 2;

// The key held to paste around blocked entries; the ghost re-evaluates when it changes.
export const FORCE_PASTE_KEY = "Shift";

/**
 * Placement-preview ghost for a blueprint: one tinted ObjectSprite per entry, snapped as a whole
 * to the tile grid under the cursor (or the screen center in center-lock). The per-tile feedback
 * is the PlacementFeedbackLayer's job.
 */
export class BlueprintGhostLayer extends AbstractDrawLayer {

    /**
     * @param {ModRegistry} modRegistry
     */
    constructor(modRegistry) {
        super();
        this._modRegistry = modRegistry;
        this._blueprint = null;
        /** @type {ObjectSprite[]} */
        this._sprites = [];
        // Holds the sprites at their entry offsets; moved as a whole onto the snapped anchor.
        this._spriteContainer = new Container();
        this.addChild(this._spriteContainer);
        // The bounds center relative to the anchor, in tiles, so the ghost pins on its middle.
        this._centerTileX = 0;
        this._centerTileY = 0;
        this._snapCallback = null;
        this._snapKey = null;
    }

    get layerIndex() {
        return 200;
    }

    /**
     * Stays visible in map mode: the active placement preview reads at any zoom.
     * @param {boolean} value
     */
    set isMapMode(value) {}

    /**
     * Shows a ghost per entry, rebuilding them only for a different blueprint.
     * @param {Blueprint} blueprint
     * @returns {void}
     */
    show(blueprint) {
        this._spriteContainer.visible = true;
        if (blueprint === this._blueprint) {
            this._layoutPin();
            return;
        }
        this.clear();
        this._blueprint = blueprint;
        const bounds = blueprint.getBounds(this._modRegistry);
        this._centerTileX = (bounds.minTileX + bounds.maxTileX) / 2;
        this._centerTileY = (bounds.minTileY + bounds.maxTileY) / 2;
        const objects = this._buildObjectsView(blueprint);
        for (const entry of blueprint.entries) {
            const type = this._modRegistry.getObjectTypeByTypeId(entry.objectTypeId);
            let bodyFrames = null;
            if (type.bodyTextureName !== null) {
                bodyFrames = [this.textureCache.get(type.bodyTextureName)];
            }
            const sprite = new ObjectSprite({
                id: 0,
                tileX: entry.tileX,
                tileY: entry.tileY,
                direction: entry.direction,
                texture: this.textureCache.get(type.getGhostTextureNameAt(objects, entry.tileX, entry.tileY, entry.direction)),
                type,
                bodyFrames,
            });
            sprite.setGhost(GHOST_TINT, GHOST_ALPHA);
            this._sprites.push(sprite);
            this._spriteContainer.addChild(sprite);
        }
        this._layoutPin();
    }

    /**
     * On each new snapped anchor (or force-paste key change) `callback(anchorX, anchorY)` evaluates
     * the placement and returns one state per entry, which tints or hides its ghost.
     * @param {function(number, number): GhostEntryState[]} callback
     * @returns {void}
     */
    setFollowCursor(callback) {
        this._snapCallback = callback;
    }

    /**
     * Forces the next frame to re-evaluate placement even on the same anchor.
     * @returns {void}
     */
    invalidateSnap() {
        this._snapKey = null;
    }

    /**
     * Hides the ghost, keeping its sprites for the next {@link show} of the same blueprint.
     * @returns {void}
     */
    hide() {
        this._spriteContainer.visible = false;
        this._snapKey = null;
    }

    clear() {
        for (const sprite of this._sprites) {
            this._spriteContainer.removeChild(sprite);
            sprite.destroy({children: true});
        }
        this._sprites = [];
        this._blueprint = null;
        this._snapKey = null;
    }

    /**
     * @param {number} frame
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     */
    tick(frame, deltaMS, visibleChunks) {
        this._layoutPin();
    }

    /**
     * The anchor tile the ghost snaps to now, or null without a live target.
     * @returns {Point|null}
     */
    snapAnchor() {
        if (this._blueprint === null) {
            return null;
        }
        const target = Mouse.aimPoint();
        if (target === null) {
            return null;
        }
        return {
            x: Math.round(target.x / TILE_SIZE - this._centerTileX - 0.5),
            y: Math.round(target.y / TILE_SIZE - this._centerTileY - 0.5),
        };
    }

    /**
     * Snaps the ghost onto the anchor under its target each frame, re-evaluating on a new anchor.
     * @private
     * @returns {void}
     */
    _layoutPin() {
        if (!this._spriteContainer.visible) {
            return;
        }
        const anchor = this.snapAnchor();
        if (anchor === null) {
            return;
        }
        const key = `${anchor.x},${anchor.y},${Keyboard.isKeyDown(FORCE_PASTE_KEY)}`;
        if (key !== this._snapKey) {
            this._snapKey = key;
            this._applyStates(this._snapCallback(anchor.x, anchor.y));
        }
        this._spriteContainer.position.set(anchor.x * TILE_SIZE, anchor.y * TILE_SIZE);
    }

    /**
     * The blueprint's entries as standing objects, ids in placement order as the sim assigns them.
     * @private
     * @param {Blueprint} blueprint
     * @returns {ObjectsView}
     */
    _buildObjectsView(blueprint) {
        const objects = new ObjectsView(null);
        for (const [index, entry] of blueprint.entries.entries()) {
            const type = this._modRegistry.getObjectTypeByTypeId(entry.objectTypeId);
            const cells = [];
            for (const {layer, cells: layerCells} of type.getPositionLayerTilesByDirection(entry.direction)) {
                for (const cell of layerCells) {
                    cells.push({x: entry.tileX + cell.x, y: entry.tileY + cell.y, layer});
                }
            }
            objects.set(index + 1, entry.tileX, entry.tileY, cells, {}, {type, direction: entry.direction});
        }
        return objects;
    }

    /**
     * @private
     * @param {GhostEntryState[]} states
     * @returns {void}
     */
    _applyStates(states) {
        for (const [index, sprite] of this._sprites.entries()) {
            const state = states[index];
            sprite.visible = state !== GHOST_ENTRY_STATE_SKIPPED;
            if (state === GHOST_ENTRY_STATE_BLOCKED) {
                sprite.setGhost(GHOST_BLOCKED_TINT, GHOST_BLOCKED_ALPHA);
            } else {
                sprite.setGhost(GHOST_TINT, GHOST_ALPHA);
            }
        }
    }
}
