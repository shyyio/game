import {
    AbstractTool,
    ToolActionEntry,
    Direction,
    Haptics,
    LAYER_SURFACE,
    LANE_LEVEL_SURFACE,
    LANE_LEVEL_BURIED,
    CreateObjectMessage,
    DeleteObjectMessage,
} from "@spup/sdk/client";
import {
    BELT_TUNNEL_DOWN,
    BELT_TUNNEL_UP,
    BeltBend,
    MAX_UNDERGROUND_LENGTH,
    getBeltKindByLevelsOrNull,
    getBeltKindEntryByKind,
} from "../common/constants.js";
import {getBeltTypeByKind, getLayerByBeltType, isBeltType} from "../common/objectTypes.js";
import {BeltEntry} from "./BeltDrawLayer.js";
import {
    inferBeltParent,
    inferElevatedBeltParent,
    getTunnelPartnerOrNull,
    getUndergroundBeltsToCreate,
} from "../common/geometry.js";

/**
 * Whether a belt facing `beltDirection` connects at `level` to a parent facing `parentDirection`;
 * a non-merging kind has only its straight-axis parent.
 * @param {BeltType} kind
 * @param {Direction} beltDirection
 * @param {Direction} parentDirection
 * @param {LaneLevel} level
 * @returns {boolean}
 */
function shouldBeltConnectToParent(kind, beltDirection, parentDirection, level) {
    const entry = getBeltKindEntryByKind(kind);
    if (entry.inLevel !== level) {
        return false;
    }
    if (!entry.isMerging) {
        return beltDirection === parentDirection;
    }
    return beltDirection !== Direction.invert(parentDirection);
}

const RAISE_HOTKEY = "w";
const LOWER_HOTKEY = "s";

/**
 * What a tap lays at a tile: the belt kind the tool's level calls for, and the tile it bends from.
 * @typedef {Object} BeltPlacement
 * @property {BeltType} kind
 * @property {ObjectType} type
 * @property {string} layer - the position layer the kind occupies
 * @property {BeltBend} bend
 */

/**
 * The one belt tool. Its build level says what a tap lays: a surface belt at the ground, an
 * elevated cell at level 1 or 2. Stepping the level arms the transition that carries the line
 * there, and that transition is the next placement: a ramp for an elevated level, and for the
 * buried one a tunnel entrance then its exit, which lands the line back on the ground.
 */
export class BeltTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {BeltGhostLayer} ghostLayer
     */
    constructor(client, ghostLayer) {
        super(client.session);
        this._client = client;
        this._cache = client.objects;
        this._ghostLayer = ghostLayer;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._rotation = client.toolRotation;
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        this._firstDragStep = false;
        // Where the line stands, and where the level steps are heading; equal with nothing armed.
        this._level = LANE_LEVEL_SURFACE;
        this._targetLevel = LANE_LEVEL_SURFACE;
        // The kinds carrying the line to the target, laid one per placement.
        this._armedKinds = [];
    }

    get label() {
        return "Belt";
    }

    get id() {
        return 2;
    }

    get textureName() {
        return "belt-straight/0";
    }

    get statusText() {
        return getBeltTypeByKind(this._getNextKind()).label;
    }

    get actions() {
        return [
            new ToolActionEntry("Raise", RAISE_HOTKEY, () => this._stepLevel(1)),
            new ToolActionEntry("Lower", LOWER_HOTKEY, () => this._stepLevel(-1)),
        ];
    }

    onDeactivate() {
        // Leaving the tool drops the level, so opening it from the toolbar always starts on the
        // ground; a tap on a placed belt sets the level before selecting it instead.
        this.setLevel(LANE_LEVEL_SURFACE);
    }

    /**
     * Puts the tool on a level with nothing armed, so the next tap lays that level's own cell.
     * @param {LaneLevel} level
     * @returns {void}
     */
    setLevel(level) {
        this._level = level;
        this._targetLevel = level;
        this._armedKinds = [];
        this.notifyStatusChange();
    }

    /**
     * Moves the target one step and re-arms what carries the line there, so stepping back to where
     * the line stands cancels the transition instead of arming another. A step no belt kind makes
     * from where the line stands is refused.
     * @private
     * @param {number} step
     * @returns {void}
     */
    _stepLevel(step) {
        const target = this._targetLevel + step;
        if (getBeltKindByLevelsOrNull(this._level, target) === null) {
            return;
        }
        this._targetLevel = target;
        this._armedKinds = this._getTransitionKinds();
        this.notifyStatusChange();
    }

    /**
     * The kinds carrying the line from where it stands to the target: none when it is already
     * there, a tunnel's two mouths when the target is buried, one ramp otherwise.
     * @private
     * @returns {BeltType[]}
     */
    _getTransitionKinds() {
        if (this._targetLevel === this._level) {
            return [];
        }
        if (this._targetLevel === LANE_LEVEL_BURIED) {
            return [BELT_TUNNEL_DOWN, BELT_TUNNEL_UP];
        }
        return [getBeltKindByLevelsOrNull(this._level, this._targetLevel)];
    }

    onTap(tileX, tileY) {
        const direction = this._rotation.direction;
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        if (this._placeBelt(tileX, tileY, direction)) {
            // Advance the center-lock crosshair one tile so consecutive taps lay a line.
            this._client.centerLock.advance(tileX, tileY, direction);
        }
        // The placement may have consumed a transition, so the ghost shows what comes next.
        this._showGhost(tileX, tileY, direction);
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._rotation.direction);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._placementFeedbackLayer.clear();
    }

    onDragStart(tileX, tileY) {
        this._firstDragStep = true;
    }

    onDragTile(tileX, tileY, direction) {
        const fromTileX = tileX - Direction.dx(direction);
        const fromTileY = tileY - Direction.dy(direction);

        if (this._firstDragStep) {
            // First drag step lays two belts: the press tile also gets one, facing the drag.
            this._firstDragStep = false;
            this._placeBelt(fromTileX, fromTileY, direction);
        } else if (direction !== this._rotation.direction && this._prevDragTileX === fromTileX && this._prevDragTileY === fromTileY) {
            // Re-lay the corner tile facing the new direction on a turn.
            this._placeBelt(fromTileX, fromTileY, direction);
        }

        // The drag direction becomes the shared facing.
        this._rotation.direction = direction;
        this._prevDragTileX = tileX;
        this._prevDragTileY = tileY;

        this._placeBelt(tileX, tileY, direction);

        // Refresh the ghost to face the actual drag step.
        this._showGhost(tileX, tileY, direction);
    }

    /**
     * Draws the placement ghost, bent from its inferred parent, with per-tile feedback.
     * @private
     * @returns {void}
     */
    _showGhost(tileX, tileY, direction) {
        const placement = this._resolvePlacement(tileX, tileY, direction);
        const occupant = this._cache.getObjectAtOrNull(tileX, tileY, placement.layer);
        const isBlocked = this._isTileBlocked(tileX, tileY, direction, placement);
        const isOverwrite = occupant !== null && !isBlocked;
        this._placementFeedbackLayer.showTile({tileX, tileY, isBlocked, isOverwrite});
        if (placement.kind === BELT_TUNNEL_UP) {
            this._showTunnelPreview(tileX, tileY, direction);
            return;
        }
        this._ghostLayer.showGhost(tileX, tileY, direction, placement.kind, placement.bend, isBlocked);
    }

    /**
     * Previews the exit mouth plus the span of buried belts back to the entrance it pairs with,
     * amber at the length past which the sim leaves the two unlinked.
     * @private
     * @returns {void}
     */
    _showTunnelPreview(tileX, tileY, direction) {
        const entrance = this._getTunnelEntranceOrNull(tileX, tileY, direction);
        if (entrance === null) {
            this._ghostLayer.showGhost(tileX, tileY, direction, BELT_TUNNEL_UP, BeltBend.STRAIGHT, true);
            return;
        }
        const span = getUndergroundBeltsToCreate(
            {x: entrance.x, y: entrance.y, type: entrance.type, direction},
            {x: tileX, y: tileY, type: BELT_TUNNEL_UP, direction},
        );
        this._ghostLayer.showTunnelPreview(tileX, tileY, direction, BELT_TUNNEL_UP, span, span.length === MAX_UNDERGROUND_LENGTH);
    }

    /**
     * What a tile takes: the armed transition when the level step left one, the tool's own level
     * otherwise.
     * @private
     * @returns {BeltPlacement}
     */
    _resolvePlacement(tileX, tileY, direction) {
        const kind = this._getNextKind();
        if (this._armedKinds.length > 0) {
            return this._buildPlacement(kind, direction, BeltBend.STRAIGHT);
        }
        let parent;
        if (this._level === LANE_LEVEL_SURFACE) {
            parent = inferBeltParent(this._cache, tileX, tileY, direction);
        } else {
            parent = inferElevatedBeltParent(this._cache, tileX, tileY, direction);
        }
        return this._buildPlacement(kind, direction, BeltEntry.getBend(direction, tileX, tileY, parent.parentX, parent.parentY));
    }

    /**
     * The kind the next tap lays: the armed transition when the level step left one, the tool's own
     * level otherwise.
     * @private
     * @returns {BeltType}
     */
    _getNextKind() {
        if (this._armedKinds.length > 0) {
            return this._armedKinds[0];
        }
        return getBeltKindByLevelsOrNull(this._level, this._level);
    }

    /**
     * @private
     * @returns {BeltPlacement}
     */
    _buildPlacement(kind, direction, bend) {
        const type = getBeltTypeByKind(kind);
        return {kind, type, layer: getLayerByBeltType(type, direction), bend};
    }

    /**
     * Whether the tile sits outside buildable chunks, a mod vetoes the placement, an occupant on
     * the kind's own layer can't be overwritten, or an elevated cell would stand on its own.
     * @private
     * @param {BeltPlacement} placement - what the tile would take, already resolved
     * @returns {boolean}
     */
    _isTileBlocked(tileX, tileY, direction, placement) {
        if (!this._client.canBuildAt(tileX, tileY)) {
            return true;
        }
        if (!this._client.isPlacementAllowedByMods(placement.type, tileX, tileY, direction)) {
            return true;
        }
        if (!this._isConnected(tileX, tileY, direction, placement)) {
            return true;
        }
        const occupant = this._cache.getObjectAtOrNull(tileX, tileY, placement.layer);
        return occupant !== null && !this._isOccupantOverwritable(occupant, placement);
    }

    /**
     * Whether the placement joins what it has to: an elevated cell needs a run to stand on, the
     * sim's own gate, and a tunnel exit needs the entrance it surfaces from.
     * @private
     * @returns {boolean}
     */
    _isConnected(tileX, tileY, direction, placement) {
        if (placement.kind === BELT_TUNNEL_UP) {
            return this._getTunnelEntranceOrNull(tileX, tileY, direction) !== null;
        }
        const entry = getBeltKindEntryByKind(placement.kind);
        if (entry.inLevel !== entry.outLevel || entry.inLevel <= LANE_LEVEL_SURFACE) {
            return true;
        }
        return this._isElevatedConnected(tileX, tileY, direction, entry.inLevel);
    }

    /**
     * Whether an elevated belt here facing `direction` would join a run at `level`: it has a parent
     * handing flow on at that level, or the cell ahead takes it as one. The client preview of the
     * sim gate `LaneBehavior.canSpawn`.
     * @private
     * @returns {boolean}
     */
    _isElevatedConnected(tileX, tileY, direction, level) {
        // A parent facing `parentDirection` stands one tile back along it; the cell ahead pointing
        // back head-on meets no input port, so that facing is skipped.
        for (let parentDirection = 0; parentDirection < 4; parentDirection += 1) {
            if (parentDirection === Direction.invert(direction)) {
                continue;
            }
            const candidateX = tileX - Direction.dx(parentDirection);
            const candidateY = tileY - Direction.dy(parentDirection);
            for (const belt of this._getBeltCandidatesAt(candidateX, candidateY)) {
                if (belt.direction === parentDirection && getBeltKindEntryByKind(belt.type).outLevel === level) {
                    return true;
                }
            }
        }
        const aheadX = tileX + Direction.dx(direction);
        const aheadY = tileY + Direction.dy(direction);
        for (const belt of this._getBeltCandidatesAt(aheadX, aheadY)) {
            if (shouldBeltConnectToParent(belt.type, belt.direction, direction, level)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The entrance an exit mouth here would surface from, or null when none is in range.
     * @private
     * @returns {object|null}
     */
    _getTunnelEntranceOrNull(tileX, tileY, direction) {
        return getTunnelPartnerOrNull(
            tileX, tileY, direction, BELT_TUNNEL_UP,
            (x, y) => this._getBeltCandidatesAt(x, y),
        );
    }

    /**
     * Every belt standing on a tile, as connection and tunnel-partner candidates.
     * @private
     * @returns {{x: number, y: number, type: BeltType, direction: Direction}[]}
     */
    _getBeltCandidatesAt(tileX, tileY) {
        return this._cache.getAtTile(tileX, tileY)
            .filter(entry => isBeltType(entry.data.type))
            .map(entry => ({
                x: entry.tileX,
                y: entry.tileY,
                type: entry.data.type.beltKind,
                direction: entry.data.direction,
            }));
    }

    /**
     * Whether the occupant is a lane of the placement's own level that the tool may re-lay.
     * @private
     * @returns {boolean}
     */
    _isOccupantOverwritable(occupant, placement) {
        if (occupant.data.type.beltKind === placement.kind) {
            return true;
        }
        return placement.layer === LAYER_SURFACE && occupant.data.type.placement.isConveyor;
    }

    /**
     * Lays one belt of the kind the level calls for, replacing an overwritable lane of that same
     * level and leaving everything else untouched. An armed transition consumes one step.
     * @private
     * @returns {boolean} whether a belt was laid
     */
    _placeBelt(tileX, tileY, direction) {
        const placement = this._resolvePlacement(tileX, tileY, direction);
        // The server would drop an ungated or mod-vetoed placement anyway.
        if (this._isTileBlocked(tileX, tileY, direction, placement)) {
            return false;
        }
        const occupant = this._cache.getObjectAtOrNull(tileX, tileY, placement.layer);
        if (occupant !== null) {
            this.session.sendMessage(new DeleteObjectMessage(occupant.id));
        }
        this.session.sendMessage(new CreateObjectMessage(placement.type.objectTypeId, tileX, tileY, direction));
        Haptics.tap();
        this._consumeArmed();
        return true;
    }

    /**
     * Drops the transition a placement just laid; the last one lands the line on the target, and a
     * tunnel's exit lands it back on the ground.
     * @private
     * @returns {void}
     */
    _consumeArmed() {
        if (this._armedKinds.length === 0) {
            return;
        }
        this._armedKinds.shift();
        if (this._armedKinds.length > 0) {
            return;
        }
        if (this._targetLevel === LANE_LEVEL_BURIED) {
            this._targetLevel = LANE_LEVEL_SURFACE;
        }
        this._level = this._targetLevel;
        this.notifyStatusChange();
    }
}
