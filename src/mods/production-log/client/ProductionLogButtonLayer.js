import {CircleButtonLayer, PANEL_TEXT, ICON_STROKE} from "@spup/sdk/client";

const BUTTON_SLOT = 5;

/**
 * The production log icon: a checklist, three ticked rows.
 * @param {Graphics} face
 * @returns {void}
 */
function drawLogIcon(face) {
    const rows = [-8, 0, 8];
    for (const y of rows) {
        face
            .moveTo(-10, y)
            .lineTo(-6, y + 3)
            .lineTo(-2, y - 3)
            .stroke({color: PANEL_TEXT, width: ICON_STROKE, join: "round", cap: "round"});
        face
            .moveTo(3, y)
            .lineTo(10, y)
            .stroke({color: PANEL_TEXT, width: ICON_STROKE, cap: "round"});
    }
}

/**
 * Always-visible top-right production log button, left of the terrain button.
 */
export class ProductionLogButtonLayer extends CircleButtonLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app, drawLogIcon);
    }

    /**
     * @protected
     * @returns {number}
     */
    _x() {
        return this._slotX(BUTTON_SLOT);
    }
}
