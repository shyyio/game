import {Container, Graphics, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TINT_TEXT, ACTIVE_ACCENT, BLOCKED_TILE_COLOR, PANEL_TINT} from "@/client/Theme.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {buildPanelButton, BUTTON_HEIGHT} from "@/client/hud/panelButton.js";
import {HudLayer} from "@/client/hud/HudLayer.js";

const PANEL_WIDTH = 360;
const PADDING = 20;
const TITLE_FONT_SIZE = 18;
const MESSAGE_FONT_SIZE = 15;
const MESSAGE_GAP = 16;
const BUTTON_GAP = 10;
const BACKDROP_ALPHA = 0.5;
// Gap between the outer frame and the sunken inset body.
const FRAME_MARGIN = 6;

/**
 * Full-screen centered confirm/cancel dialog with a dimmed backdrop; a screen-space HUD on
 * app.stage. One dialog at a time — opening replaces whatever is already shown.
 */
export class ConfirmDialogLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this.textureRegistry = null;
        this.zIndex = HudLayer.DIALOG;
        this.visible = false;
        this.eventMode = "none";

        this._backdrop = new Graphics();
        this._backdrop.eventMode = "static";
        this.addChild(this._backdrop);
        this._panel = null;
        // Last open() arguments, so restyle can rebuild the same dialog.
        this._options = null;

        app.renderer.on("resize", () => this._layoutBackdrop());
        this._layoutBackdrop();
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        if (this.visible) {
            this.open(this._options);
        }
    }

    /**
     * Opens the dialog: a title, a message, a Cancel button, and a confirm button labeled
     * `confirmLabel` (styled as destructive) that invokes `onConfirm` and closes.
     * @param {object} options
     * @param {string} options.title
     * @param {string} options.message
     * @param {string} options.confirmLabel
     * @param {function(): void} options.onConfirm
     * @returns {void}
     */
    open({title, message, confirmLabel, onConfirm}) {
        this.close();
        this._options = {title, message, confirmLabel, onConfirm};
        this.eventMode = "static";

        const panel = new Container();

        const titleText = new Text({
            text: title,
            style: {fontFamily: GAME_FONT, fontSize: TITLE_FONT_SIZE, fill: PANEL_TINT_TEXT, fontWeight: "bold"},
        });
        titleText.x = FRAME_MARGIN + PADDING;
        titleText.y = FRAME_MARGIN + PADDING;
        panel.addChild(titleText);

        const messageText = new Text({
            text: message,
            style: {
                fontFamily: GAME_FONT,
                fontSize: MESSAGE_FONT_SIZE,
                fill: PANEL_TINT_TEXT,
                wordWrap: true,
                wordWrapWidth: PANEL_WIDTH - PADDING * 2,
            },
        });
        messageText.x = FRAME_MARGIN + PADDING;
        messageText.y = titleText.y + titleText.height + MESSAGE_GAP;
        panel.addChild(messageText);

        const buttonsY = messageText.y + messageText.height + MESSAGE_GAP;
        const confirmButton = buildPanelButton(this.textureRegistry, confirmLabel, BLOCKED_TILE_COLOR, () => {
            this.close();
            onConfirm();
        });
        const cancelButton = buildPanelButton(this.textureRegistry, "Cancel", ACTIVE_ACCENT, () => this.close());
        confirmButton.x = PANEL_WIDTH - FRAME_MARGIN - PADDING - confirmButton.width;
        confirmButton.y = buttonsY;
        cancelButton.x = confirmButton.x - BUTTON_GAP - cancelButton.width;
        cancelButton.y = buttonsY;
        panel.addChild(cancelButton);
        panel.addChild(confirmButton);

        const panelHeight = buttonsY + BUTTON_HEIGHT + PADDING + FRAME_MARGIN;
        const frame = UIPanel.frameSprite(this.textureRegistry, PANEL_WIDTH, panelHeight, PANEL_TINT);
        const inset = UIPanel.insetSprite(this.textureRegistry, PANEL_WIDTH - FRAME_MARGIN * 2, panelHeight - FRAME_MARGIN * 2, PANEL_TINT);
        inset.position.set(FRAME_MARGIN, FRAME_MARGIN);
        panel.addChildAt(inset, 0);
        panel.addChildAt(frame, 0);

        // Swallow presses so they don't fall through to the map.
        panel.eventMode = "static";
        panel.on("pointerdown", (e) => e.stopPropagation());

        panel.x = Math.round((this._app.screen.width - PANEL_WIDTH) / 2);
        panel.y = Math.round((this._app.screen.height - panelHeight) / 2);

        this._panel = panel;
        this.addChild(panel);
        this.visible = true;
    }

    /**
     * Closes the dialog if open; a no-op otherwise.
     * @returns {void}
     */
    close() {
        if (this._panel !== null) {
            this._panel.destroy({children: true});
            this._panel = null;
        }
        this.visible = false;
        this.eventMode = "none";
    }

    /**
     * @private
     * @returns {void}
     */
    _layoutBackdrop() {
        this._backdrop.clear()
            .rect(0, 0, this._app.screen.width, this._app.screen.height)
            .fill({color: 0x000000, alpha: BACKDROP_ALPHA});
    }
}
