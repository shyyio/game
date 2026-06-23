import {AbstractMessage} from "@/common/AbstractMessage.js";

/**
 * Base class for every event the game emits to a session. Extends AbstractMessage purely
 * to reuse its `wireFields` contract — like a message, every concrete event must
 * declare a static `wireFields` map (the AbstractMessage constructor enforces it).
 *
 * Carries no position: events tied to a place in the world extend
 * AbstractTilePositionedEvent, which adds (x, y) and a derived `chunk`. Events with no
 * position (e.g. settings sync) extend AbstractEvent directly.
 */
export class AbstractEvent extends AbstractMessage {

}
