import {AbstractTool} from "@/client/input/AbstractTool.js";
import {Direction} from "@/common/constants.js";
import {DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import Haptics from "@/client/Haptics.js";
import {evaluatePlacement, getPlaceOnTargetTiles} from "@/client/input/placementEvaluation.js";

/**
 * Tap-to-place tool: drops one object over its geometry, overwriting an aligned conveyor lane (and
 * optionally its own type), with orientation + center-lock. Placement knobs come from the type's
 * PlacementRule; `shouldDragToPlace` adds drag-to-lay, one placement per tile entered. Belt's drag-to-lay
 * tools are bespoke.
 */
export class ObjectTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {ObjectType} type - the object type placed (its objectTypeId on the message, its placement
     *     rule for the overwrite/advance/placeOn knobs)
     * @param {ObjectGhostLayer} ghostLayer
     */
    constructor(client, type, ghostLayer) {
        super(client.session);
        if (type.toolId === null) {
            throw new Error(`Object type "${type.name}" has no toolId`);
        }
        this._client = client;
        this._cache = client.objects;
        this._type = type;
        this._ghostLayer = ghostLayer;
        this._advanceOnPlace = type.placement.shouldAdvanceOnPlace;
        this._placeOn = type.placement.placeOn;
        this._dragToPlace = type.placement.shouldDragToPlace;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        // A non-directional type keeps _rotation null: rotate() no-ops, the rotate buttons hide
        // (orientable), and placement always faces UP.
        this._rotation = type.directional ? client.toolRotation : null;
        this._active = false;
        // Cache-listener unsubscribes, held only while active.
        this._unsubscribes = [];
        // The floating ghost calls back to repaint the placement feedback as it snaps.
        this._ghostLayer.setFollowCursor((baseX, baseY, direction) => this._previewFollow(baseX, baseY, direction));
    }

    get label() {
        return this._type.label;
    }

    get id() {
        return this._type.toolId;
    }

    get textureName() {
        return this._type.textureName;
    }

    get remainingPlacements() {
        if (this._type.initialPlacementLimit === null) {
            return null;
        }
        return this._client.cache.view("placementLimits").getRemainingByTypeId(this._type.objectTypeId);
    }

    onTap(tileX, tileY) {
        const direction = this._placementDirection();
        // Snap and evaluate synchronously from the live cursor/rotation, so a tap never trusts a
        // ticker-stale preview.
        const base = this._ghostLayer.snapBase(direction);
        if (base === null) {
            return;
        }
        const blockedReason = this._placeAt(base.x, base.y, direction);
        if (blockedReason !== null) {
            this._client.drawPlacementBlockedReason(base.x, base.y, blockedReason);
            return;
        }
        if (this._client.centerLock.enabled && this._advanceOnPlace) {
            // Advances the center-lock crosshair one tile so consecutive taps lay a line.
            this._client.centerLock.advance(tileX, tileY, direction);
        }
    }

    /**
     * Places the object at the base tile facing `direction`, deleting its overwrites first.
     * @private
     * @returns {string|null} why it did not place, null when it did
     */
    _placeAt(baseX, baseY, direction) {
        const result = evaluatePlacement(this._client, this._type, baseX, baseY, direction);
        if (result.blockedReason !== null) {
            return result.blockedReason;
        }
        if (result.isAlreadyPlaced) {
            return null;
        }
        for (const id of result.overwriteIds) {
            this.session.sendMessage(new DeleteObjectMessage(id));
        }
        this.session.sendMessage(new CreateObjectMessage(this._type.objectTypeId, baseX, baseY, direction));
        Haptics.tap();
        // Re-evaluate next frame so the just-placed tile now reads as occupied.
        this._ghostLayer.invalidateSnap();
        return null;
    }

    /**
     * Repaints the placement feedback (green target where it lands) as the ghost snaps. Returns
     * whether it's blocked, for the ghost tint.
     * @private
     * @returns {boolean}
     */
    _previewFollow(baseX, baseY, direction) {
        const result = evaluatePlacement(this._client, this._type, baseX, baseY, direction);
        this._placementFeedbackLayer.show({
            blocked: result.blockedCells,
            overwrite: result.overwriteCells,
            clear: result.clearCells,
            shouldShowTarget: true,
        });
        return result.blockedCells.length > 0;
    }

    onActivate() {
        this._active = true;
        if (this._placeOn.length > 0) {
            // Keep the target highlight live as resources come and go, only while active.
            this._unsubscribes.push(this._cache.onStructuralChange(() => this._resyncHighlight()));
            this._unsubscribes.push(this._cache.onRemove(() => this._resyncHighlight()));
        }
        if (this._type.initialPlacementLimit !== null) {
            // A count or bonus landing re-tints the resting ghost.
            this._unsubscribes.push(this._client.cache.subscribe("placementLimits.countByTypeId", () => this._ghostLayer.invalidateSnap()));
            this._unsubscribes.push(this._client.cache.subscribe("placementLimits.bonusTypeIds", () => this._ghostLayer.invalidateSnap()));
        }
        this._resyncHighlight();
    }

    onDeactivate() {
        this._active = false;
        for (const unsubscribe of this._unsubscribes) {
            unsubscribe();
        }
        this._unsubscribes = [];
        this._placementFeedbackLayer.clearHighlight();
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._placementDirection());
    }

    /**
     * The facing a placement uses: the shared rotation, or UP for a non-directional type.
     * @private
     * @returns {Direction}
     */
    _placementDirection() {
        if (this._rotation !== null) {
            return this._rotation.direction;
        }
        return Direction.UP;
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._placementFeedbackLayer.clear();
    }

    /**
     * Repaints the blue highlight over every current target tile, while this tool is active.
     * @private
     */
    _resyncHighlight() {
        if (!this._active || this._placeOn.length === 0) {
            return;
        }
        this._placementFeedbackLayer.highlight(getPlaceOnTargetTiles(this._client, this._type));
    }

    onDragStart(tileX, tileY) {
        // The pressed tile gets its placement before the first step, so a dragged run starts under
        // the press.
        this._dragPlace(tileX, tileY);
    }

    onDragTile(tileX, tileY, direction) {
        // The step direction is ignored: placement keeps the tool facing.
        this._dragPlace(tileX, tileY);
    }

    /**
     * Lays one placement at a dragged-over tile, when the type opts into drag-to-lay. A tile already
     * holding this type is left untouched.
     * @private
     */
    _dragPlace(tileX, tileY) {
        if (!this._dragToPlace) {
            return;
        }
        const occupant = this._cache.getObjectAtOrNull(tileX, tileY, this._type.positionLayer);
        if (occupant !== null && occupant.data.type === this._type) {
            return;
        }
        this._placeAt(tileX, tileY, this._placementDirection());
    }

    /**
     * Draws the ghost (tinted red when any cell is blocked) and the per-tile geometry feedback
     * (blocked red, overwrite blue, clear green target).
     * @private
     */
    _showGhost(tileX, tileY, direction) {
        // The ghost floats onto its target (cursor, or screen center in center-lock): just (re)create
        // the sprite; the layer pins it and drives the snapped feedback via _previewFollow each frame.
        this._ghostLayer.showGhost(tileX, tileY, direction, false);
    }
}
