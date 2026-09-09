import {nineSlice} from "@/client/layers/pixiUtils.js";

// The 9-slice frame shared by every slot-shaped widget: inspect slots, toolbar slots, panel buttons.
const TX_SLOT = "ui/Frame02a_inset4";
export const SLOT_FRAME_INSET = 12;

/**
 * The slot frame at the given on-screen size, tinted; square for a slot, wide for a button or bar.
 * @param {TextureCache} textureCache
 * @param {number} width
 * @param {number} height
 * @param {number} tint
 * @returns {NineSliceSprite}
 */
export function slotFrameSprite(textureCache, width, height, tint) {
    const sprite = nineSlice(textureCache, TX_SLOT, SLOT_FRAME_INSET, SLOT_FRAME_INSET, width, height);
    sprite.tint = tint;
    return sprite;
}
