export class NotImplementedError extends Error {
    constructor() {
        super("This method has not been implemented yet.");
        this.name = "NotImplementedError";

        // Captures the correct stack trace in Node.js environments
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

// A placement was refused (tile occupied, duplicate, conflicting parent). Thrown so a
// nested creation unwinds to its transaction owner, which rolls back exactly once.
export class PlacementRejected extends Error {
    constructor() {
        super("Placement rejected.");
        this.name = "PlacementRejected";

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
