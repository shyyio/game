import {EMPTY} from "@spup/sdk";

/**
 * Applies a POST_RESOLVE seam's staged hops: the internal ports stage2 drains are cleared before
 * stage1 refills them, and the out-port fills defer to PRODUCE_OUTPUTS.
 * @param {GameEngine} engine
 * @param {{intPort:number, item:number, inPort:number}[]} stage1 - in-port to internal port
 * @param {{outPort:number, item:number, intPort:number}[]} stage2 - internal port to out-port
 * @param {{outPort:number, item:number}[]} outputFills
 * @returns {void}
 */
export function commitStagedHops(engine, stage1, stage2, outputFills) {
    for (const record of stage2) {
        engine.ports.setItem(record.intPort, EMPTY);
    }
    for (const record of stage1) {
        engine.ports.consumeItem(record.inPort);
    }
    for (const record of stage1) {
        engine.ports.setItem(record.intPort, record.item);
    }
    for (const record of stage2) {
        outputFills.push(record);
    }
}
