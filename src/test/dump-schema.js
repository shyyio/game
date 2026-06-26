// Prints the full live database schema — every persistent table/index followed
// by the temporary ones — as a single SQL string. Boots an in-memory game with
// this repo's content mods loaded (see src/test/common.js) so the dump reflects
// every mod's schema/tempSchema, then reads it back out of the database.
//
// Run through the test loader so the `@/` alias resolves. `npm run schema` pipes
// this script's SQL into the sqlite3 CLI to build ./SCHEMA.sqlite3, a real
// database you can open and inspect; see the package.json script:
//
//   npm run schema
//   node --import ./src/test/test-loader.js src/test/dump-schema.js | sqlite3 SCHEMA.sqlite3

import {setup} from "@/test/common.js";

async function main() {
    const harness = await setup();
    console.log(harness.db.dumpSchema());
}

main();
