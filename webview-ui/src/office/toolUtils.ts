import { TILE_SIZE, ZOOM_MAX, ZOOM_MIN } from '../constants.js';

/** Map status prefixes back to tool names for animation selection */
const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Globbing: 'Glob',
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

/**
 * Compute a default integer zoom level, fit to the viewport rather than only
 * to devicePixelRatio (Simviotik fork). The upstream DPR-only formula left
 * the office looking like a small island in a lot of empty background on any
 * screen bigger than a compact laptop panel, and undershot badly on small
 * high-DPR phones in the other direction. Fit-to-viewport works for both:
 * aim to fill most of the smaller viewport dimension with the ~21-tile
 * default office layout, clamped to the app's existing zoom bounds.
 */
export function defaultZoom(): number {
  const ASSUMED_OFFICE_TILES = 21;
  const FILL_RATIO = 0.85;
  const smallerDimension = Math.min(window.innerWidth, window.innerHeight);
  const fitZoom = (smallerDimension * FILL_RATIO) / (ASSUMED_OFFICE_TILES * TILE_SIZE);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(fitZoom)));
}

// ── Provider capabilities (tool taxonomy for rendering decisions) ────────────
// Populated once by the `providerCapabilities` postMessage after `webviewReady`.
// Modules classifying tools (character animation, subagent creation gate) read
// from here instead of hardcoding Claude-specific tool names.

const providerCaps: {
  readingTools: Set<string>;
  subagentToolNames: Set<string>;
} = {
  readingTools: new Set(),
  subagentToolNames: new Set(),
};

export function setProviderCapabilities(caps: {
  readingTools: string[];
  subagentToolNames: string[];
}): void {
  providerCaps.readingTools = new Set(caps.readingTools);
  providerCaps.subagentToolNames = new Set(caps.subagentToolNames);
}

export function isReadingToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && providerCaps.readingTools.has(name);
}

export function isSubagentToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && providerCaps.subagentToolNames.has(name);
}
