// The snapshot shape a save carries. Bump on any shape change, with a SAVE_MIGRATIONS entry.
export const SAVE_FORMAT = 1;

// What a save written before the stamp counts as.
const UNSTAMPED_FORMAT = 0;

/**
 * Upgrades keyed by the format they read: entry N takes a format-N snapshot, returns format N+1.
 * They run on the plain snapshot before any engine sees it, so one chain serves every backend;
 * mutating the input is fine.
 * @type {Map<number, function(object): object>}
 */
export const SAVE_MIGRATIONS = new Map([
    // Format 1 holds the same content as an unstamped save, so stamping is the whole migration.
    [UNSTAMPED_FORMAT, snapshot => ({...snapshot, saveFormat: UNSTAMPED_FORMAT + 1, gameVersion: null})],
]);

/**
 * Upgrades a loaded snapshot to {@link SAVE_FORMAT} by running each migration in turn.
 * @param {object} snapshot - as read from a save store
 * @param {Map<number, function(object): object>} [migrations] - the chain to walk
 * @returns {object} a snapshot at the current format
 */
export function migrateSnapshot(snapshot, migrations=SAVE_MIGRATIONS) {
    let format = snapshotFormat(snapshot);
    if (format > SAVE_FORMAT) {
        throw new Error(
            `Save is format ${format}, but this build reads ${SAVE_FORMAT}: it was written by a newer `
            + "build. Upgrade the build rather than downgrading the save."
        );
    }
    let migrated = snapshot;
    while (format < SAVE_FORMAT) {
        const migration = migrations.get(format);
        if (migration === undefined) {
            throw new Error(`No migration from save format ${format} to ${format + 1}; this save cannot be upgraded.`);
        }
        migrated = migration(migrated);
        const next = snapshotFormat(migrated);
        if (next !== format + 1) {
            throw new Error(`Migration from save format ${format} left the snapshot at ${next}, not ${format + 1}.`);
        }
        format = next;
    }
    return migrated;
}

/**
 * @param {object} snapshot
 * @returns {number} its declared format, or {@link UNSTAMPED_FORMAT} when it predates the stamp
 */
function snapshotFormat(snapshot) {
    const format = snapshot.saveFormat;
    if (format === undefined || format === null) {
        return UNSTAMPED_FORMAT;
    }
    if (!Number.isInteger(format) || format < 0) {
        throw new Error(`Save declares a nonsense format: ${JSON.stringify(format)}`);
    }
    return format;
}
