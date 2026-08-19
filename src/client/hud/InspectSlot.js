import {Container, Sprite} from "pixi.js";
import {PANEL_TINT} from "@/client/Theme.js";
import {addSlotHighlight} from "@/client/hud/slotHighlight.js";
import {nineSlice} from "@/client/layers/pixiUtils.js";
import {SLOT_FRAME_INSET, TX_SLOT} from "@/client/hud/slotFrame.js";

export const SLOT_SIZE = 60;
const ITEM_INSET = 6;
// An item the machine holds but that is not resting in the port.
const ABSENT_ALPHA = 0.6;
/**
 * One inspect item slot: frame plus item icon, dimmed while the item is not in the port.
 * Persistent — {@link InspectSlot#setItem} mutates it, so a per-tick snapshot never rebuilds it.
 */
export class InspectSlot extends Container {

    /**
     * @param {TextureRegistry} textureRegistry
     * @param {ItemRegistry} items
     * @param {SlotTooltip} tooltip - raised while the pointer rests on this slot
     */
    constructor(
        textureRegistry,
        items,
        tooltip,
    ) {
        super();
        this._textureRegistry = textureRegistry;
        this._items = items;
        this._item = 0;
        this._present = false;

        this._frame = nineSlice(textureRegistry, TX_SLOT, SLOT_FRAME_INSET, SLOT_FRAME_INSET, SLOT_SIZE, SLOT_SIZE);
        this._frame.tint = PANEL_TINT;
        this.addChild(this._frame);

        // Hover highlight (no active state on inspect slots).
        addSlotHighlight(this, SLOT_SIZE);

        this._icon = new Sprite();
        this._icon.visible = false;
        this.addChild(this._icon);

        this.on("pointerenter", () => tooltip.setTarget(this));
        this.on("pointerleave", () => tooltip.clearTarget(this));
    }

    /**
     * @returns {number} the item shown (0 = empty)
     */
    get item() {
        return this._item;
    }

    /**
     * @returns {string|null} the held item's name, null while the slot is empty
     */
    get itemName() {
        if (this._item === 0) {
            return null;
        }
        return this._items.definitionFor(this._item).name;
    }

    /**
     * Shows an item (0 = empty); the presence drives the icon opacity.
     * @param {number} item
     * @param {boolean} present - whether the item is resting in the port
     * @returns {void}
     */
    setItem(item, present) {
        if (item === this._item && present === this._present) {
            return;
        }
        this._item = item;
        this._present = present;
        this._refresh();
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._frame.tint = PANEL_TINT;
    }

    /**
     * @returns {void}
     * @private
     */
    _refresh() {
        if (this._item === 0) {
            this._icon.visible = false;
            return;
        }
        const definition = this._items.definitionFor(this._item);
        this._icon.texture = this._textureRegistry.get(definition.texture);
        this._icon.tint = definition.tint;
        const box = SLOT_SIZE - ITEM_INSET * 2;
        this._icon.scale.set(Math.min(box / this._icon.texture.width, box / this._icon.texture.height));
        this._icon.x = (SLOT_SIZE - this._icon.width) / 2;
        this._icon.y = (SLOT_SIZE - this._icon.height) / 2;
        this._icon.visible = true;
        if (this._present) {
            this._icon.alpha = 1;
        } else {
            this._icon.alpha = ABSENT_ALPHA;
        }
    }
}
