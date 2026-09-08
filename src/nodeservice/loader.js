import {registerHooks} from "node:module";
import {resolve, load} from "./hooks.js";

// The production Node entry: registers the @/ alias + asset hooks WITHOUT marking the process as a
// test run, so env.js DEV stays false.
registerHooks({resolve, load});
