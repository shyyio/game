// Player-setting keys; 1-3 reserved (persisted by old saves).
export const CURSOR_SETTING_SHARE = 4;
export const CURSOR_SETTING_DISPLAY = 5;

// Audience option indices for both settings (the stored value is the index).
export const CURSOR_AUDIENCE_NONE = 0;
export const CURSOR_AUDIENCE_FRIENDS = 1;
export const CURSOR_AUDIENCE_EVERYONE = 2;
// The audience of an absent setting, applied by the sim gate, client mirror, and control alike.
export const CURSOR_AUDIENCE_DEFAULT = CURSOR_AUDIENCE_EVERYONE;
// Option labels, indexed by audience; each setting's label ends in the completing preposition.
export const CURSOR_AUDIENCE_OPTIONS = ["No one", "Friends", "Everyone"];

/**
 * Whether an audience option admits another player; the holder admits themselves always,
 * except with no one.
 * @param {number} mode CURSOR_AUDIENCE_* option
 * @param {boolean} isSelf
 * @param {boolean} isFriend whether the other player is on the option holder's friend list
 * @returns {boolean}
 */
export function audienceAdmits(mode, isSelf, isFriend) {
    if (mode === CURSOR_AUDIENCE_NONE) {
        return false;
    }
    if (isSelf) {
        return true;
    }
    if (mode === CURSOR_AUDIENCE_FRIENDS) {
        return isFriend;
    }
    return true;
}

// Own-cursor heartbeat interval; nothing is sent while the cursor rests. The receiver
// interpolates over the same interval, trailing one heartbeat behind.
export const CURSOR_SEND_INTERVAL_MS = 100;
