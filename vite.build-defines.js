import {execSync} from "node:child_process";
import {readFileSync} from "node:fs";

/**
 * @returns {{commit: string, date: string}} HEAD's commit hash and commit date (ISO 8601)
 */
export function gitBuildInfo() {
    const [commit, date] = execSync("git show -s --format=%H%n%cI HEAD").toString().trim().split("\n");
    return {commit, date};
}

/**
 * @returns {string} the version the package publishes
 */
export function packageVersion() {
    return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
}
