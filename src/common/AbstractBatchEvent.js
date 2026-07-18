import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";
import {NotImplementedError} from "@/common/error.js";

/**
 * One chunk's deltas for a whole emit pass, packed into columns so a pass costs one envelope per
 * chunk instead of one per delta. The receiver unpacks it back into the per-delta events handlers
 * consume, so batching stays a wire concern: nothing downstream of {@link explode} knows about it.
 *
 * (x, y) is any position in the batched chunk, carried to route the batch to that chunk's topic.
 * @abstract
 */
export class AbstractBatchEvent extends AbstractTilePositionedEvent {

    /**
     * The per-delta events this batch stands for, in the order they were emitted.
     * @abstract
     * @returns {AbstractTilePositionedEvent[]}
     */
    explode() {
        throw new NotImplementedError();
    }
}
