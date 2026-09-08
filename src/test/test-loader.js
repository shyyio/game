import {registerHooks} from "node:module";
import {resolve, load} from "../nodeservice/hooks.js";

// Marks this Node process as a test run so shared code (e.g. env.js DEV) can
// enable dev-only behavior; the server/prod Node entry never loads this.
globalThis.__TEST__ = true;

registerHooks({resolve, load});
