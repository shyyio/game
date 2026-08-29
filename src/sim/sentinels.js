// The two "absent" values the engine's typed-array columns carry. Both are -1, so a column can be
// zero-filled and still read as absent only where the fill says so; they are distinct constants
// because they answer different questions, and a reader should say which one it means.

// Port.item sentinel for an empty port.
export const EMPTY = -1;

// Field sentinel for an eid-reference field with no target (a fresh port, an absent seam).
export const NO_EID = -1;
