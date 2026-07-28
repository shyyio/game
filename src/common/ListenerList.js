/**
 * An ordered list of callbacks: push-to-add, closure unsubscribe, snapshot-safe notify.
 */
export class ListenerList {

    constructor() {
        /**
         * @type {Function[]}
         * @private
         */
        this._listeners = [];
    }

    /**
     * Registers a listener.
     * @param {Function} listener
     * @returns {function(): void} unsubscribe
     */
    add(listener) {
        this._listeners.push(listener);
        return () => {
            const index = this._listeners.indexOf(listener);
            if (index !== -1) {
                this._listeners.splice(index, 1);
            }
        };
    }

    /**
     * Calls every listener with the arguments; iterates a snapshot, so a listener may
     * unsubscribe (or subscribe) mid-notify.
     * @param {...*} args
     * @returns {void}
     */
    notify(...args) {
        for (const listener of [...this._listeners]) {
            listener(...args);
        }
    }
}
