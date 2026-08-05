import {execSync} from "node:child_process";

/**
 * @returns {{commit: string, date: string}} HEAD's commit hash and commit date (ISO 8601)
 */
export function gitBuildInfo() {
    const [commit, date] = execSync("git show -s --format=%H%n%cI HEAD").toString().trim().split("\n");
    return {commit, date};
}
