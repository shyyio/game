import {formatCount} from "@spup/sdk";
import {COIN_COLOR} from "./icons.js";

// A debit reads as spent; a credit stays coin gold, like the balance counter.
export const DEBIT_COLOR = 0xE0574B;

// Splats from one terminal land a tick apart, so they spread rather than stack.
export const TRADE_SPLAT_JITTER = 0.15;

/**
 * A settled trade's credit movement as splat text, sign first; the coin trails it.
 * @param {number} amount - negative when the terminal bought
 * @returns {string}
 */
export function formatTradeAmount(amount) {
    if (amount < 0) {
        return `-${formatCount(-amount)}`;
    }
    return `+${formatCount(amount)}`;
}

/**
 * The color a settled trade's splat draws in.
 * @param {number} amount - negative when the terminal bought
 * @returns {number}
 */
export function getSplatColorByAmount(amount) {
    if (amount < 0) {
        return DEBIT_COLOR;
    }
    return COIN_COLOR;
}
