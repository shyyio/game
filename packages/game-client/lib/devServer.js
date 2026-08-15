// The static server behind `spup-dev client`: the prebuilt game client at /, the mod package being
// worked on at /mod/. No dependencies and no native code — an author who only writes a mod never
// installs a game server.

import {createServer} from "node:http";
import {createReadStream, existsSync, statSync} from "node:fs";
import {extname, join, resolve, sep} from "node:path";

// Where a built package is mounted; the client is pointed at it with ?mod=.
export const MOD_MOUNT = "/mod/";

const MIME_TYPES = new Map([
    [".css", "text/css"],
    [".html", "text/html"],
    [".ico", "image/x-icon"],
    [".jpg", "image/jpeg"],
    [".js", "text/javascript"],
    [".json", "application/json"],
    [".map", "application/json"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".webp", "image/webp"],
    [".woff2", "font/woff2"],
]);

const FALLBACK_MIME_TYPE = "application/octet-stream";

/**
 * The file a URL path names, or null when it escapes the root or is not a file.
 * @param {string} root
 * @param {string} path a URL path, already stripped of its mount prefix
 * @returns {string|null}
 */
function fileFor(root, path) {
    let decoded;
    try {
        decoded = decodeURIComponent(path);
    } catch {
        // A malformed escape names no file, and must not take a dev server down.
        return null;
    }
    const candidate = resolve(join(root, decoded));
    if (candidate !== root && !candidate.startsWith(root + sep)) {
        return null;
    }
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
        return null;
    }
    return candidate;
}

/**
 * @param {ServerResponse} response
 * @param {string} path
 * @returns {void}
 */
function sendFile(response, path) {
    const type = MIME_TYPES.get(extname(path));
    response.writeHead(200, {
        "content-type": type === undefined ? FALLBACK_MIME_TYPE : type,
        // The mod bundle is rebuilt in place on every save, and the client's own files are hashed.
        "cache-control": "no-store",
    });
    createReadStream(path).pipe(response);
}

/**
 * Serves the client and one mod package until the process exits.
 * @param {object} options
 * @param {string} options.clientDir the prebuilt client bundle
 * @param {string} options.modDir the built mod package
 * @param {number} options.port
 * @param {string} options.host
 * @returns {Promise<Server>} listening
 */
export function startDevServer({clientDir, modDir, port, host}) {
    const clientRoot = resolve(clientDir);
    const modRoot = resolve(modDir);
    const server = createServer((request, response) => {
        const {pathname} = new URL(request.url, "http://localhost");
        if (pathname.startsWith(MOD_MOUNT)) {
            const file = fileFor(modRoot, pathname.slice(MOD_MOUNT.length));
            if (file === null) {
                response.writeHead(404, {"content-type": "text/plain"}).end(`No ${pathname} in the built mod\n`);
                return;
            }
            sendFile(response, file);
            return;
        }
        // Anything the client bundle does not have is one of its own routes (/play, /mods), which
        // the single-page app resolves itself.
        const file = fileFor(clientRoot, pathname);
        if (file === null) {
            sendFile(response, join(clientRoot, "index.html"));
            return;
        }
        sendFile(response, file);
    });
    return new Promise((resolveListening, reject) => {
        server.on("error", reject);
        server.listen(port, host, () => resolveListening(server));
    });
}
