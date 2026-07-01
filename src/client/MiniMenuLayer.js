import {Container, Graphics, Text} from "pixi.js";
import {MiniMenuEntry} from "@/common/core.js";
import {GAME_FONT} from "@/client/constants.js";

const PADDING = 6;
const ITEM_HEIGHT = 28;
const ITEM_PADDING_X = 12;

export class MiniMenuLayer extends Container {

    /**
     * @param {ClientViewport} viewport - frozen while the menu is open
     */
    constructor(viewport) {
        super();
        this._viewport = viewport;
        this._menu = null;
        this._clickOffMenuListener = null;
        this._onClose = null;
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

        const allEntries = [...entries, new MiniMenuEntry("Cancel", -Infinity, () => {})];

        this._menu = new Container();
        this._menu.x = screenX;
        this._menu.y = screenY;

        const labels = allEntries.map(entry => new Text({
            text: entry.label,
            style: {fontFamily: GAME_FONT, fontSize: 13, fill: 0xffffff},
        }));

        const menuWidth = Math.max(...labels.map(l => l.width)) + ITEM_PADDING_X * 2;
        const menuHeight = allEntries.length * ITEM_HEIGHT + PADDING * 2;

        const bg = new Graphics();
        bg.roundRect(0, 0, menuWidth, menuHeight, 4)
            .fill({color: 0x1a1a1a, alpha: 0.92})
            .stroke({color: 0x555555, width: 1});
        this._menu.addChild(bg);

        allEntries.forEach((entry, i) => {
            const item = new Container();
            item.y = PADDING + i * ITEM_HEIGHT;
            item.eventMode = "static";
            item.cursor = "pointer";

            const hoverBg = new Graphics();
            hoverBg.roundRect(2, 0, menuWidth - 4, ITEM_HEIGHT, 3).fill({color: 0x444444});
            hoverBg.alpha = 0;
            item.addChild(hoverBg);

            const label = labels[i];
            label.x = ITEM_PADDING_X;
            label.y = (ITEM_HEIGHT - label.height) / 2;
            item.addChild(label);

            item.on("pointerover", () => { hoverBg.alpha = 1; });
            item.on("pointerout", () => { hoverBg.alpha = 0; });
            item.on("pointerdown", (e) => {
                e.nativeEvent.stopPropagation();
                // Only a primary (left) click activates an entry; swallow other
                // buttons so a right-click on an entry does nothing.
                if (e.button !== 0) {
                    return;
                }
                entry.callback();
                this.close();
            });

            this._menu.addChild(item);
        });

        this._menu.eventMode = "static";
        this._menu.on("pointerdown", (e) => e.nativeEvent.stopPropagation());

        this._clickOffMenuListener = () => this.close();
        window.addEventListener("pointerdown", this._clickOffMenuListener);

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
        if (this._clickOffMenuListener) {
            window.removeEventListener("pointerdown", this._clickOffMenuListener);
            this._clickOffMenuListener = null;
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
