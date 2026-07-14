import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {NotImplementedError} from "@/common/error.js";

/**
 * Shared scaffolding for the drop-in sim modules (machine, extractor, resource): a mod constructs one
 * and calls {@link AbstractEasyModule#install} to wire create/delete placement, chunk sync, and
 * inspection. Subclasses supply the type-matching, placement, removal, and sync behavior via the
 * abstract hooks; {@link AbstractEasyModule#inspect} is optional.
 * @abstract
 */
export class AbstractEasyModule {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;
    }

    /**
     * Wires this module into `sim`: create/delete placement, chunk sync, and inspection. One call, no
     * bespoke mod code.
     * @param {GameEngine} sim
     * @returns {void}
     */
    install(sim) {
        sim.registerMessageHandler(message => this._message(sim, message));
        sim.registerChunkSync(chunk => this.chunkSync(chunk));
        sim.registerInspector(id => this.inspect(id));
    }

    /**
     * @private
     * @param {GameEngine} sim
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _message(sim, message) {
        if (message instanceof DeleteObjectMessage) {
            return this.remove(message.id);
        }
        if (message instanceof CreateObjectMessage && this.handles(message.typeId)) {
            return this.place(sim, message);
        }
        return false;
    }

    /**
     * Whether this module places objects of `typeId`.
     * @abstract
     * @param {number} typeId
     * @returns {boolean}
     */
    handles(typeId) {
        throw new NotImplementedError();
    }

    /**
     * Places an object from a CreateObjectMessage; returns whether the message was handled.
     * @abstract
     * @param {GameEngine} sim
     * @param {CreateObjectMessage} message
     * @returns {boolean}
     */
    place(sim, message) {
        throw new NotImplementedError();
    }

    /**
     * Removes the object with client id `clientId`; returns whether one was removed.
     * @abstract
     * @param {number} clientId
     * @returns {boolean}
     */
    remove(clientId) {
        throw new NotImplementedError();
    }

    /**
     * The EasyObjectSyncEvents recreating this module's objects in `chunk`.
     * @abstract
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        throw new NotImplementedError();
    }

    /**
     * The inspect snapshot for `clientId`, or null when this module has no such object or is not
     * inspectable.
     * @param {number} clientId
     * @returns {object|null}
     */
    inspect(clientId) {
        return null;
    }
}
