import {BrowserGameBackend} from "@/backend/BrowserGameBackend.js";

/**
 * @param value {any}
 * @param expected {any}
 */
export const assert = (value, expected) => {

    if (value !== expected) {
        throw new Error(`Expected ${expected}, got ${value}.`)
    }
}

/**
 * @returns {Promise<BrowserGameBackend>}
 */
export async function setup() {
    const backend = new BrowserGameBackend();

    await backend.init();

    return backend;
}

export function assertThrowsError(func) {

    let threwError = false;
    try {
        func()
    } catch (e) {
        threwError = true;
    }

    if (!threwError) {
        throw new Error(`Function did not throw an error.`)
    }
}

export async function executeTests(suite, tests) {
    const promises = Object.keys(tests).map(name => {
        return new Promise(async resolve => {
            try {
                await tests[name]();
                console.log(`%c${name.padEnd(50, ".")}OK`,  "color: #008000");
                resolve(true);
            } catch (e) {
                console.error(e);
                resolve(false);
            }
        });
    });

    const results = await Promise.all(promises);

    if (!results.some(r => !r)) {
        console.log(`%cAll tests OK. (${suite})`,  "color: #008000");
    }
}
