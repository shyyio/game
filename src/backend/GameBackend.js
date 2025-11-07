
/**
 * @callback BackendEventCallback
 * @param event {GameEvent}
 */

/**
 * @abstract
 */
export class GameBackend {

    async init() {
    }

    /**
     * @param type {EventType}
     * @param callback {BackendEventCallback}
     */
    on(type, callback) {
    }
}
