import {
    AbstractDebugDrawLayer,
    Container,
    Graphics,
    Text,
    TILE_SIZE,
    GAME_FONT,
    DEBUG_COLOR,
    drawRect,
} from "@/sdk/client.js";
import {isPipeType} from "../common/objectTypes.js";

const MEMBER_FILL_ALPHA = 0.3;
const LABEL_TEXT_SIZE = 15;

/**
 * Debug overlay tinting each pipe network's member tiles (keyed by network id) with an
 * "id: amount/capacity" label at its first member.
 */
export class NetworkDebugDrawLayer extends AbstractDebugDrawLayer {

    /**
     * @param {Map<number, number[]>} networkParts - shared network id -> member pipe ids, owned by FluidsClientMod
     * @param {Map<number, {fluidType: number, amount: number}>} fluidByNetwork - shared fluid state, same owner
     * @param {number} segmentCapacity - units one pipe segment buffers
     */
    constructor(networkParts, fluidByNetwork, segmentCapacity) {
        super();
        this._networkParts = networkParts;
        this._fluidByNetwork = fluidByNetwork;
        this._segmentCapacity = segmentCapacity;
        this._graphics = new Graphics();
        this._labels = new Container();
        this.addChild(this._graphics);
        this.addChild(this._labels);
    }

    get layerIndex() {
        return 101;
    }

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheChange(entry) {
        if (isPipeType(entry.data.type)) {
            this.markStale();
        }
    }

    /**
     * Repaints every tracked network.
     * @private
     * @returns {void}
     */
    _repaint() {
        this._graphics.clear();
        for (const label of this._labels.removeChildren()) {
            label.destroy();
        }
        for (const [networkId, parts] of this._networkParts) {
            this._drawNetwork(networkId, parts);
        }
    }

    /**
     * @private
     * @param {number} networkId
     * @param {number[]} parts - member pipe ids
     * @returns {void}
     */
    _drawNetwork(networkId, parts) {
        const records = parts.map(id => this.cache.get(id));
        // A pipe left the viewport (or was just deleted): wait for the next recalc.
        if (records.length === 0 || records.some(record => record === null)) {
            return;
        }
        const color = DEBUG_COLOR(networkId);
        for (const record of records) {
            this._graphics.rect(record.tileX * TILE_SIZE, record.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
        this._graphics.fill({color, alpha: MEMBER_FILL_ALPHA});
        for (const record of records) {
            drawRect(this._graphics, record.tileX * TILE_SIZE, record.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE, color);
        }

        const fluid = this._fluidByNetwork.get(networkId);
        let amount = 0;
        if (fluid !== undefined) {
            amount = fluid.amount;
        }
        const label = new Text({
            text: `${networkId}: ${amount}/${parts.length * this._segmentCapacity}`,
            style: {
                fontFamily: GAME_FONT,
                fontSize: LABEL_TEXT_SIZE,
                fill: color,
                fontWeight: "bold",
                stroke: {color: 0x000000, width: 2},
            },
        });
        label.x = records[0].tileX * TILE_SIZE + 2;
        label.y = records[0].tileY * TILE_SIZE + 2;
        this._labels.addChild(label);
    }
}
