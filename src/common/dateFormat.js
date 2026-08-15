// How a timestamp reads in the UI: an age while that is the useful thing ("3 days ago"), a plain
// date once it is a year old, since "17 months ago" says less to a reader than "Jul 15, 2024".

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const MONTHS_UNTIL_ABSOLUTE = 12;

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en-US", {numeric: "always"});
const ABSOLUTE_FORMAT = new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric"});

const UNITS = [
    {ms: DAY_MS, unit: "day"},
    {ms: HOUR_MS, unit: "hour"},
    {ms: MINUTE_MS, unit: "minute"},
    {ms: SECOND_MS, unit: "second"},
];

/**
 * Whole calendar months between two dates.
 * @param {Date} date
 * @param {Date} now
 * @returns {number}
 */
function monthsBetween(date, now) {
    const months = (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth();
    if (now.getDate() < date.getDate()) {
        return months - 1;
    }
    return months;
}

/**
 * A past date as an age, or as "Jul 15, 2024" once it is twelve months or older.
 * @param {string} isoDate
 * @param {Date} [now]
 * @returns {string}
 */
export function formatPastDate(isoDate, now = new Date()) {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Not a date: ${JSON.stringify(isoDate)}`);
    }
    const months = monthsBetween(date, now);
    if (months >= MONTHS_UNTIL_ABSOLUTE) {
        return ABSOLUTE_FORMAT.format(date);
    }
    if (months >= 1) {
        return RELATIVE_FORMAT.format(-months, "month");
    }
    const elapsed = now.getTime() - date.getTime();
    for (const {ms, unit} of UNITS) {
        if (elapsed >= ms) {
            return RELATIVE_FORMAT.format(-Math.floor(elapsed / ms), unit);
        }
    }
    // Under a second, or a future timestamp from a skewed clock.
    return "just now";
}
