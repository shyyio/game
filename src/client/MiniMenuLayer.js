import {Container, Graphics, Text} from "pixi.js";
import {MiniMenuEntry} from "@/common/ObjectType.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TEXT, PANEL_TINT, SLOT_HIGHLIGHT_COLOR, LABEL_EMPHASIS} from "@/client/Theme.js";
import {UIPanel} from "@/client/UIPanel.js";

const PADDING = 6;
const ITEM_HEIGHT = 32;
const ITEM_PADDING_X = 16;
// Gap between the outer frame and the sunken inset body.
const FRAME_MARGIN = 6;
const HOVER_ALPHA = 0.2;

/**
 * Builds a menu label: the first word in normal weight, the remainder bold and
 * accented. Single-word labels render plain.
 * @param {string} text
 * @returns {Container}
 */
function buildLabel(text) {
    const container = new Container();
    const split = text.indexOf(" ");
    const firstWord = split === -1 ? text : text.slice(0, split + 1);
    const rest = split === -1 ? "" : text.slice(split + 1);

    const head = new Text({
        text: firstWord,
        style: {fontFamily: GAME_FONT, fontSize: 16, fill: PANEL_TEXT},
    });
    container.addChild(head);

    if (rest !== "") {
        const tail = new Text({
            text: rest,
            style: {fontFamily: GAME_FONT, fontSize: 16, fill: LABEL_EMPHASIS, fontWeight: "bold"},
        });
        tail.x = head.width;
        container.addChild(tail);
    }
    return container;
}

export class MiniMenuLayer extends Container {

    /**
     * @param {ClientViewport} viewport - frozen while the menu is open
     */
    constructor(viewport) {
        super();
        this._viewport = viewport;
        this.textureRegistry = null;
        this._menu = null;
        this._pressDownListener = null;
        this._pressUpListener = null;
        this._onClose = null;
        // A click requires a fresh press that begins after the menu is open, so the
        // gesture that opened it (a touch long-press, held down when the menu appears)
        // can't self-activate or self-close on release. Armed by any post-open press.
        this._armed = false;
        // The entry whose item received the armed press; null if it landed off an entry.
        this._pressedEntry = null;
        this.visible = false;
        this.zIndex = 1000;
    }

    /**
     * @param {MiniMenuEntry[]} entries
     * @param {number} screenX
     * @param {number} screenY
     * @param {function(): void} [onClose] - invoked once when the menu closes
     */
    open(entries, screenX, screenY, onClose=null) {
        this.close();
        this._onClose = onClose;
        this._armed = false;
        this._pressedEntry = null;

        const allEntries = [...entries, new MiniMenuEntry("Cancel", -Infinity, () => {})];

        this._menu = new Container();

        const labels = allEntries.map(entry => buildLabel(entry.label));

        const menuWidth = Math.max(...labels.map(l => l.width)) + ITEM_PADDING_X * 2 + FRAME_MARGIN * 2;
        const menuHeight = allEntries.length * ITEM_HEIGHT + PADDING * 2 + FRAME_MARGIN * 2;

        this._menu.x = screenX - menuWidth / 2;
        this._menu.y = screenY;

        const frame = UIPanel.frameSprite(this.textureRegistry, menuWidth, menuHeight, PANEL_TINT);
        this._menu.addChild(frame);
        const inset = UIPanel.insetSprite(this.textureRegistry, menuWidth - FRAME_MARGIN * 2, menuHeight - FRAME_MARGIN * 2, PANEL_TINT);
        inset.position.set(FRAME_MARGIN, FRAME_MARGIN);
        this._menu.addChild(inset);

        for (const [i, entry] of allEntries.entries()) {
            const item = new Container();
            item.x = FRAME_MARGIN;
            item.y = FRAME_MARGIN + PADDING + i * ITEM_HEIGHT;
            item.eventMode = "static";
            item.cursor = "pointer";

            const hoverBg = new Graphics();
            hoverBg.rect(0, 0, menuWidth - FRAME_MARGIN * 2, ITEM_HEIGHT).fill(SLOT_HIGHLIGHT_COLOR);
            hoverBg.alpha = 0;
            item.addChild(hoverBg);

            const label = labels[i];
            label.x = ITEM_PADDING_X;
            label.y = (ITEM_HEIGHT - label.height) / 2;
            item.addChild(label);

            item.on("pointerover", () => { hoverBg.alpha = HOVER_ALPHA; });
            item.on("pointerout", () => { hoverBg.alpha = 0; });
            item.on("pointerdown", (e) => {
                e.nativeEvent.stopPropagation();
                // Only a primary (left) press arms an entry; a right-press does nothing.
                if (e.button !== 0) {
                    return;
                }
                this._armed = true;
                this._pressedEntry = entry;
            });
            item.on("pointerup", (e) => {
                e.nativeEvent.stopPropagation();
                // Ignore the release of the gesture that opened the menu.
                if (!this._armed) {
                    return;
                }
                // A click activates only when press and release land on the same entry.
                if (this._pressedEntry === entry) {
                    entry.callback();
                }
                this.close();
            });

            this._menu.addChild(item);
        }

        this._menu.eventMode = "static";
        this._menu.on("pointerdown", (e) => e.nativeEvent.stopPropagation());

        // A press outside the menu arms an off-entry gesture; releasing it closes the
        // menu (but only after release, and never on the opening gesture's release).
        this._pressDownListener = () => {
            this._armed = true;
            this._pressedEntry = null;
        };
        this._pressUpListener = () => {
            if (!this._armed) {
                return;
            }
            this.close();
        };
        window.addEventListener("pointerdown", this._pressDownListener);
        window.addEventListener("pointerup", this._pressUpListener);

        this.addChild(this._menu);
        this.visible = true;

        // The menu is anchored to a screen position; freeze the viewport so the
        // world can't pan or zoom out from under it while it is open.
        this._viewport.freeze();
    }

    close() {
        if (this._menu) {
            this._menu.destroy({children: true});
            this._menu = null;
        }
        if (this._pressDownListener) {
            window.removeEventListener("pointerdown", this._pressDownListener);
            window.removeEventListener("pointerup", this._pressUpListener);
            this._pressDownListener = null;
            this._pressUpListener = null;
        }
        this.visible = false;
        this._viewport.unfreeze();
        if (this._onClose) {
            const onClose = this._onClose;
            this._onClose = null;
            onClose();
        }
    }
}
