/**
 * Deterministic RNG for diversity tests.
 *
 * Every statistical claim about the engine — full-cycle coverage, distribution
 * fairness, soft-diversity behaviour — is asserted over simulated games. Those
 * simulations must be reproducible, so they inject this instead of
 * `Math.random`: a linear congruential generator with the constants from
 * Numerical Recipes. Good enough to be unbiased for our purposes, tiny, and
 * identical on every machine and every run.
 */
export function seededRng(seed = 1): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
