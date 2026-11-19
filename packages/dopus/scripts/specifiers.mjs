// The module specifiers a built file imports. Split out of check-build.mjs so it can be tested.

// Static imports/exports at the start of a line, plus dynamic import()/require() in code position (after an operator,
// `(` or `[`, `=>`, `await` or `return`), not inside a string such as a generated config template or a JSDoc type.
const SPECIFIER =
  /(?:^\s*(?:import|export)\b[^'"\n]*?|^\s*import\s*|\bfrom\s*)["']([^"']+)["']|(?:^|[=(,;:?&|!>[]\s*|\bawait\s+|\breturn\s+)(?:import\s*\(|require\s*\()\s*["']([^"']+)["']/gm

/** @param {string} code @returns {string[]} */
export const specifiers = (code) => [...code.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2])
