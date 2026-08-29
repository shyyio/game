import {Container} from "pixi.js";
import {HudLayer} from "@/client/hud/HudLayer.js";
import {UIPanel} from "@/client/hud/UIPanel.js";

/**
 * The one place a panel layer mounts. It carries the {@link HudLayer.PANEL} band for every layer it
 * holds, so a layer's own stacking is decided here rather than by the order it was built in: a press
 * anywhere inside a layer raises that layer over its siblings, and the pressed {@link UIPanel} over
 * the other panels of that layer.
 */
export class PanelHost extends Container {

    constructor() {
        super();
        this.zIndex = HudLayer.PANEL;
        // Capture, so the press is seen before a panel control stops it propagating.
        this.eventMode = "static";
        this.addEventListener("pointerdown", (event) => this._raiseTo(event.target), {capture: true});
    }

    /**
     * Mounts a panel layer; the band is the host's, so the layer must not carry a zIndex of its own.
     * @param {Container} layer
     * @returns {void}
     */
    add(layer) {
        if (layer.zIndex !== 0) {
            throw new Error(`${layer.constructor.name} sets zIndex ${layer.zIndex}; a panel layer takes its stacking from the panel host`);
        }
        this.addChild(layer);
    }

    /**
     * Raises the layer holding `target`, and the panel within it, over their siblings.
     * @private
     * @param {Container} target
     * @returns {void}
     */
    _raiseTo(target) {
        let panel = null;
        let layer = null;
        let node = target;
        while (node !== null && node !== this) {
            if (node instanceof UIPanel) {
                panel = node;
            }
            if (node.parent === this) {
                layer = node;
            }
            node = node.parent;
        }
        if (layer === null) {
            return;
        }
        if (panel !== null) {
            panel.parent.addChild(panel);
        }
        this.addChild(layer);
    }
}
