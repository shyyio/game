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
