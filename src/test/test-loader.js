import {register} from "node:module";

// Marks this Node process as a test run so shared code (e.g. env.js DEV) can
// enable dev-only behavior; the server/prod Node entry never loads this.
globalThis.__TEST__ = true;

register("./test-hooks.js", import.meta.url);
