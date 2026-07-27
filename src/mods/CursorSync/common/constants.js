// Player-setting keys (0/absent = on).
export const CURSOR_SETTING_SHARE = 1;
export const CURSOR_SETTING_SHOW = 2;

// Own-cursor heartbeat interval; nothing is sent while the cursor rests. The receiver
// interpolates over the same interval, trailing one heartbeat behind.
export const CURSOR_SEND_INTERVAL_MS = 100;
