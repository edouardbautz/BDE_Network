import '@testing-library/jest-dom/vitest';

// `TZ=Pacific/Auckland npm run test` plays the tests in another time zone (CI does, see "Conventions" in docs/architecture.md). Node
// on Windows ignores a TZ given at launch and only honours one assigned while it runs: assigning it again here makes the command
// work on every system, and changes nothing where it already worked.
if (process.env.TZ) process.env.TZ = process.env.TZ;
