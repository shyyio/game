import {Container, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PROGRESS_TEXT_STROKE, WORKER_MISSING_TEXT, WORKER_OK_TEXT} from "@/client/Theme.js";
import {InspectSlot, SLOT_SIZE} from "@/client/hud/InspectSlot.js";
import {InspectProgressBar, PROGRESS_HEIGHT} from "@/client/hud/InspectProgressBar.js";

const SLOT_MARGIN_Y = 10;
const SLOT_MARGIN_X = 10;

const WORKER_TEXT_SIZE = 15;
const WORKER_TEXT_STROKE_WIDTH = 1;
const WORKER_ROW_HEIGHT = WORKER_TEXT_SIZE + SLOT_MARGIN_Y;

// Total content height: inputs row, then a row sharing the progress bar and output slot.
const BASE_CONTENT_HEIGHT = SLOT_SIZE + SLOT_MARGIN_Y + SLOT_SIZE;

// Ticks a port item keeps its present look after leaving the port: a machine pulling one item per
// tick empties its ports every tick, which would otherwise read as flicker.
const PRESENCE_HOLD_TICKS = 2;

/**
 * The body height for a machine's snapshot; worker-consuming machines get an extra status row.
 * @param {InspectHeartbeatState} event
 * @returns {number}
 */
export function inspectContentHeight(event) {
    let workerRow = 0;
    if (event.workerCost !== null) {
        workerRow = WORKER_ROW_HEIGHT;
    }
    return BASE_CONTENT_HEIGHT + workerRow;
}

/**
 * A machine's inspect body: input slots, progress bar, output slot, and a worker row for the
 * machines that consume workers. Built once per panel and mutated per heartbeat, so nothing on it
 * blinks as the snapshots arrive.
 */
export class InspectContent extends Container {

    /**
     * @param {InspectHeartbeatState} event - the first snapshot, which fixes the layout
     * @param {number} contentWidth - width available inside the panel body
     * @param {TextureRegistry} textureRegistry
     * @param {ItemRegistry} items
     * @param {SlotTooltip} tooltip - raised while the pointer rests on one of these slots
     */
    constructor(
        event,
        contentWidth,
        textureRegistry,
        items,
        tooltip,
    ) {
        super();
        // Output slot right-aligned in the body (independent of the input columns).
        const outputX = contentWidth - SLOT_SIZE;
        const secondRowY = SLOT_SIZE + SLOT_MARGIN_Y;

        this._inputSlots = [];
        // Per input port, the ticks its present look still has to run.
        this._inputHold = [];
        for (const [i] of event.inputPorts.entries()) {
            const slot = new InspectSlot(textureRegistry, items, tooltip);
            slot.x = i * (SLOT_SIZE + SLOT_MARGIN_X);
            this.addChild(slot);
            this._inputSlots.push(slot);
            this._inputHold.push(0);
        }

        this._progressBar = new InspectProgressBar(textureRegistry, outputX - SLOT_MARGIN_X, event.processingTotal);
        this._progressBar.y = secondRowY + (SLOT_SIZE - PROGRESS_HEIGHT) / 2;
        this.addChild(this._progressBar);

        this._outputSlot = new InspectSlot(textureRegistry, items, tooltip);
        this._outputSlot.x = outputX;
        this._outputSlot.y = secondRowY;
        this.addChild(this._outputSlot);
        this._outputHold = 0;

        this._workerLabel = null;
        if (event.workerCost !== null) {
            this._workerLabel = new Text({
                text: "",
                style: {
                    fontFamily: GAME_FONT,
                    fontSize: WORKER_TEXT_SIZE,
                    fill: WORKER_OK_TEXT,
                    fontWeight: "bold",
                    stroke: {color: PROGRESS_TEXT_STROKE, width: WORKER_TEXT_STROKE_WIDTH},
                },
            });
            this._workerLabel.y = secondRowY + SLOT_SIZE + SLOT_MARGIN_Y;
            this.addChild(this._workerLabel);
            this._workerStaffed = true;
        }
    }

    /**
     * Applies a snapshot.
     * @param {InspectHeartbeatState} event
     * @param {number|undefined} lastProduced - the machine's last produced item (output fallback)
     * @returns {void}
     */
    update(event, lastProduced) {
        for (const [i, slot] of this._inputSlots.entries()) {
            const portItem = event.inputPorts[i];
            this._inputHold[i] = holdAfter(this._inputHold[i], portItem !== 0);
            let item = portItem;
            if (portItem === 0) {
                item = event.inputMemory[i];
            }
            slot.setItem(item, this._inputHold[i] > 0);
        }

        this._progressBar.setProgress(event.processingRemaining, event.processingTotal);

        // Out-port item first, else the inferred recipe output, else the last produced item.
        this._outputHold = holdAfter(this._outputHold, event.outputItem !== null);
        let outputItem = 0;
        if (event.outputItem !== null) {
            outputItem = event.outputItem;
        } else if (this._outputHold > 0) {
            outputItem = this._outputSlot.item;
        } else if (event.recipeOutput !== null) {
            outputItem = event.recipeOutput;
        } else if (lastProduced !== undefined) {
            outputItem = lastProduced;
        }
        this._outputSlot.setItem(outputItem, this._outputHold > 0);

        if (this._workerLabel !== null) {
            this._updateWorkerRow(event);
        }
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        for (const slot of this._inputSlots) {
            slot.restyle();
        }
        this._progressBar.restyle();
        this._outputSlot.restyle();
        if (this._workerLabel !== null) {
            this._workerLabel.style.stroke = {color: PROGRESS_TEXT_STROKE, width: WORKER_TEXT_STROKE_WIDTH};
            this._workerLabel.style.fill = workerRowColor(this._workerStaffed);
        }
    }

    /**
     * One status line for a worker-consuming machine: staffing state plus its road network's
     * demand/supply, red while the machine runs unmanned.
     * @param {InspectHeartbeatState} event
     * @returns {void}
     * @private
     */
    _updateWorkerRow(event) {
        const staffed = event.workers === event.workerCost;
        this._workerStaffed = staffed;
        let text;
        if (event.workerSupply === null) {
            text = `No road access · needs ${event.workerCost} workers`;
        } else if (staffed) {
            text = `Manned · ${event.workerCost} workers · network ${event.workerDemand}/${event.workerSupply}`;
        } else {
            text = `Staffed ${event.workers}/${event.workerCost} · network ${event.workerDemand}/${event.workerSupply}`;
        }
        this._workerLabel.text = text;
        this._workerLabel.style.fill = workerRowColor(staffed);
    }
}

/**
 * @param {boolean} staffed
 * @returns {number}
 */
function workerRowColor(staffed) {
    if (staffed) {
        return WORKER_OK_TEXT;
    }
    return WORKER_MISSING_TEXT;
}

/**
 * The hold counter after a tick: a port item recharges it, an empty port spends one tick of it.
 * @param {number} hold
 * @param {boolean} inPort
 * @returns {number}
 */
function holdAfter(hold, inPort) {
    if (inPort) {
        return PRESENCE_HOLD_TICKS;
    }
    return Math.max(0, hold - 1);
}

