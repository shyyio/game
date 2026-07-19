import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// housingId sentinel for a machine with no assigned housing (no workers granted).
export const NO_HOUSING = 0;

/**
 * A road-attached machine's labor state changed: `workers` granted (0 = unstaffed) from `housingId`
 * (NO_HOUSING when none). `attached` 0 means the machine left the road network entirely.
 */
export class LaborAssignmentEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        x: "sint32",
        y: "sint32",
        machineId: "int64",
        housingId: "int64",
        workers: "int32",
        attached: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} machineId
     * @param {number} housingId
     * @param {number} workers
     * @param {number} attached
     */
    constructor(x, y, machineId, housingId, workers, attached) {
        super(x, y);
        this.machineId = machineId;
        this.housingId = housingId;
        this.workers = workers;
        this.attached = attached;
    }
}

/**
 * One chunk's road-attached machines for a sync: machine `machineIds[i]` at chunk-relative
 * (`tileX[i]`, `tileY[i]`) holds `workers[i]` granted workers from `housingIds[i]`.
 */
export class LaborAssignmentBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        originX: "sint32",
        originY: "sint32",
        tileX: "sint32[]",
        tileY: "sint32[]",
        machineIds: "int64[]",
        housingIds: "int64[]",
        workers: "int32[]",
    };

    /**
     * @param {number} originX - the batched chunk's origin tile, which also routes the batch
     * @param {number} originY
     */
    constructor(originX, originY) {
        super(originX, originY);
        this.originX = originX;
        this.originY = originY;
        this.tileX = [];
        this.tileY = [];
        this.machineIds = [];
        this.housingIds = [];
        this.workers = [];
    }

    /**
     * @param {number} machineId
     * @param {number} housingId
     * @param {number} workers
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    add(machineId, housingId, workers, x, y) {
        this.tileX.push(x - this.originX);
        this.tileY.push(y - this.originY);
        this.machineIds.push(machineId);
        this.housingIds.push(housingId);
        this.workers.push(workers);
    }

    /**
     * @returns {LaborAssignmentEvent[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.machineIds.length; i += 1) {
            events.push(new LaborAssignmentEvent(
                this.originX + this.tileX[i],
                this.originY + this.tileY[i],
                this.machineIds[i],
                this.housingIds[i],
                this.workers[i],
                1,
            ));
        }
        return events;
    }
}
