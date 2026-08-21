import {createApp} from "vue";
import SpriteEditor from "@/client/spriteEditor/SpriteEditor.vue";

const WINDOW_NAME = "spup-sprite-editor";
const WINDOW_FEATURES = "popup=yes,width=1240,height=780";

/**
 * Mounts the editor in its own browser window; it shares the page's JS context, so the live
 * atlas and the override store are the same objects the game draws from.
 * @param {SpriteEditorSession} session
 * @param {function(): void} onClosed fires once the window is gone, however it went
 * @returns {function(): void} closes the window
 */
export function openSpriteEditorWindow(session, onClosed) {
    const popup = window.open("", WINDOW_NAME, WINDOW_FEATURES);
    if (popup === null) {
        throw new Error("The browser blocked the editor window. Allow popups for this site, then press the brush button.");
    }
    const doc = popup.document;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${document.baseURI}"><title>Sprite editor</title>`
        + `<style>html, body, body > div { height: 100%; margin: 0; overflow: hidden; }</style></head><body></body></html>`);
    doc.close();
    // The editor's styles live in the opener's head (vite-injected or the chunk's stylesheet).
    for (const node of document.head.querySelectorAll("style, link[rel=\"stylesheet\"]")) {
        doc.head.appendChild(node.cloneNode(true));
    }
    const mount = doc.createElement("div");
    doc.body.appendChild(mount);

    let closed = false;
    const finish = () => {
        if (closed) {
            return;
        }
        closed = true;
        app.unmount();
        onClosed();
    };
    const app = createApp(SpriteEditor, {session});
    app.mount(mount);

    popup.addEventListener("pagehide", finish);
    // Closing the game page takes the editor window with it.
    window.addEventListener("pagehide", () => popup.close());

    return () => {
        popup.close();
        finish();
    };
}
