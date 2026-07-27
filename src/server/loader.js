import {register} from "node:module";

// The production Node entry: registers the @/ alias + asset hooks WITHOUT marking the process as a
// test run, so env.js DEV stays false.
register("./hooks.js", import.meta.url);
