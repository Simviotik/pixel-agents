import { TOUCH_DEBUG_QUERY_PARAM } from '../constants.js';

/**
 * On-device diagnostics for the terminal touch-scroll gesture. iOS Safari
 * offers no console on a phone, so with ?touchdebug in the URL the gesture
 * handlers count their events into a small fixed overlay — one stalled
 * scroll then shows exactly which link of the chain went quiet (moves not
 * arriving vs. non-cancelable moves vs. a touchcancel vs. ticks not
 * emitted). No-ops entirely without the flag; not wired to React.
 */
export const touchDebugEnabled =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has(TOUCH_DEBUG_QUERY_PARAM);

let hud: HTMLDivElement | null = null;
const counts = new Map<string, number>();
let lastKey = '';

/** Count one gesture event under a short key and repaint the HUD. */
export function touchDebugCount(key: string): void {
  if (!touchDebugEnabled) return;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  lastKey = key;
  if (!hud) {
    hud = document.createElement('div');
    // pixel-panel supplies themed colors; layout is fixed top-left, under
    // the top chrome, click-through so it never eats a gesture itself.
    hud.className = 'pixel-panel';
    hud.style.position = 'fixed';
    hud.style.top = 'calc(env(safe-area-inset-top, 0px) + 48px)';
    hud.style.left = '8px';
    hud.style.zIndex = '100';
    hud.style.padding = '4px 6px';
    hud.style.fontSize = '15px';
    hud.style.lineHeight = '1.3';
    hud.style.pointerEvents = 'none';
    hud.style.whiteSpace = 'pre-wrap';
    hud.style.maxWidth = '70vw';
    document.body.appendChild(hud);
  }
  hud.textContent =
    [...counts.entries()].map(([k, v]) => `${k}:${String(v)}`).join(' ') + `\nlast:${lastKey}`;
}
