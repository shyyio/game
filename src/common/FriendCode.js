// Crockford base32: ambiguous letters (I, L, O, U) dropped.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_DIGITS = 8;
// Last digit is a checksum over the rest, so a single mistyped digit is rejected instead of
// silently resolving to another player's id.
const PAYLOAD_DIGITS = CODE_DIGITS - 1;

/**
 * @param {string} payloadDigits
 * @returns {string} the checksum digit
 */
function checksumOf(payloadDigits) {
    let sum = 0;
    for (const char of payloadDigits) {
        sum += ALPHABET.indexOf(char);
    }
    return ALPHABET[sum % 32];
}

/**
 * A player id as a short, typeable code (grouped XXXX-XXXX) — what players exchange to add each
 * other as friends, now that display names aren't unique identity keys.
 * @param {number} playerId
 * @returns {string}
 */
export function encodeFriendCode(playerId) {
    let n = playerId;
    let payload = "";
    for (let i = 0; i < PAYLOAD_DIGITS; i++) {
        payload = ALPHABET[n % 32] + payload;
        n = Math.floor(n / 32);
    }
    const digits = payload + checksumOf(payload);
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/**
 * @param {string} code
 * @returns {number|null} the playerId, or null if code is malformed or fails its checksum
 */
export function decodeFriendCode(code) {
    const digits = code.toUpperCase().replace(/[\s-]/g, "");
    if (digits.length !== CODE_DIGITS) {
        return null;
    }
    const payload = digits.slice(0, PAYLOAD_DIGITS);
    const checkDigit = digits.slice(PAYLOAD_DIGITS);
    let playerId = 0;
    for (const char of payload) {
        const value = ALPHABET.indexOf(char);
        if (value === -1) {
            return null;
        }
        playerId = playerId * 32 + value;
    }
    if (ALPHABET.indexOf(checkDigit) === -1 || checkDigit !== checksumOf(payload)) {
        return null;
    }
    return playerId;
}
