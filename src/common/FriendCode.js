// Crockford base32: ambiguous letters (I, L, O, U) dropped.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_DIGITS = 8;
// Last digit is a checksum over the rest, so a single mistyped digit is rejected instead of
// silently resolving to another player's code.
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
 * @param {string} digits - undashed canonical digits
 * @returns {string}
 */
function formatFriendCode(digits) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/**
 * A fresh, unguessable friend code (grouped XXXX-XXXX) — what players exchange to add each other
 * as friends. Random, not derived from playerId or sub: a deterministic mapping would let anyone
 * enumerate every player by walking the input space.
 * @returns {string}
 */
export function generateFriendCode() {
    const bytes = new Uint8Array(PAYLOAD_DIGITS);
    crypto.getRandomValues(bytes);
    let payload = "";
    for (let i = 0; i < PAYLOAD_DIGITS; i++) {
        payload += ALPHABET[bytes[i] % 32];
    }
    return formatFriendCode(payload + checksumOf(payload));
}

/**
 * Normalizes a user-typed code to its canonical undashed uppercase form, verifying its checksum.
 * Does not check whether the code belongs to any real player.
 * @param {string} code
 * @returns {string|null} the canonical digits, or null if malformed or fails its checksum
 */
export function normalizeFriendCode(code) {
    const digits = code.toUpperCase().replace(/[\s-]/g, "");
    if (digits.length !== CODE_DIGITS) {
        return null;
    }
    const payload = digits.slice(0, PAYLOAD_DIGITS);
    const checkDigit = digits.slice(PAYLOAD_DIGITS);
    for (const char of payload) {
        if (ALPHABET.indexOf(char) === -1) {
            return null;
        }
    }
    if (ALPHABET.indexOf(checkDigit) === -1 || checkDigit !== checksumOf(payload)) {
        return null;
    }
    return digits;
}

/**
 * @param {string} code
 * @returns {boolean} whether code is well-formed (format + checksum only, not existence)
 */
export function isValidFriendCode(code) {
    return normalizeFriendCode(code) !== null;
}
