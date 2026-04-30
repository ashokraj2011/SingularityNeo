/**
 * Single source of truth for how many prior chat turns the client forwards
 * to the server. Both the floating Event Horizon dock and the full Chat page
 * import this so they cannot drift out of sync again.
 *
 * The server independently re-evaluates the window via tokenOptimization.ts —
 * this constant only controls the upper bound the CLIENT will ever ship in a
 * single request. The server may further trim if its own policy is tighter.
 */
export const MAX_HISTORY_FOR_LLM = 24;
