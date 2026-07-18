import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';

import {
  TERMINAL_FLICK_DECAY_PER_MS,
  TERMINAL_FLICK_MIN_VELOCITY_PX_PER_MS,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE_PX,
  TERMINAL_RESIZE_DEBOUNCE_MS,
  TERMINAL_SCROLLBACK_LINES,
  TERMINAL_THEME,
  TOUCH_TAP_MAX_DURATION_MS,
  TOUCH_TAP_MAX_MOVE_PX,
} from '../constants.js';
import type { TerminalConnectionStatus } from '../terminal/terminalClient.js';
import { TerminalConnection } from '../terminal/terminalClient.js';

interface TerminalPaneProps {
  agentId: number;
  /** Hidden panes stay mounted so their xterm buffer and socket survive tab
   *  switches — unmounting would drop the scrollback and force a reconnect. */
  isActive: boolean;
  onStatusChange?: (agentId: number, status: TerminalConnectionStatus) => void;
  /** Override the terminal font size (mobile uses a smaller face for columns). */
  fontSizePx?: number;
  /** Focus xterm when the pane opens/activates. Mobile passes false: focusing
   *  raises the software keyboard over half the screen on every view switch —
   *  there, tapping the terminal itself is what summons the keyboard. */
  autoFocus?: boolean;
  /** Hands the caller a function that writes raw bytes to this pane's PTY
   *  (null on teardown) — how the mobile key bar injects keys the software
   *  keyboard doesn't have. */
  onRegisterInput?: (agentId: number, send: ((data: string) => void) | null) => void;
}

/**
 * One xterm.js instance bound to one agent's PTY.
 *
 * xterm is imperative and owns its own DOM, so it lives outside React state and
 * is driven entirely through refs — the same pattern OfficeCanvas uses for the
 * game loop.
 */
export function TerminalPane({
  agentId,
  isActive,
  onStatusChange,
  fontSizePx = TERMINAL_FONT_SIZE_PX,
  autoFocus = true,
  onRegisterInput,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);

  // Keep the latest callback reachable without making it an effect dependency:
  // a caller passing an inline arrow would otherwise tear down the terminal and
  // reconnect the socket on every parent render.
  const statusRef = useRef(onStatusChange);
  statusRef.current = onStatusChange;
  const registerInputRef = useRef(onRegisterInput);
  registerInputRef.current = onRegisterInput;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: fontSizePx,
      theme: { ...TERMINAL_THEME },
      scrollback: TERMINAL_SCROLLBACK_LINES,
      cursorBlink: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    const connection = new TerminalConnection(agentId, {
      onOutput: (data) => term.write(data),
      onReplay: (data, cols, rows) => {
        // Reproduce the server's screen exactly: size the terminal to the
        // geometry the snapshot was serialized at, then write it after an
        // in-band full reset (RIS). RIS rather than term.reset() so the clear
        // is ordered within xterm's async write queue and works before open();
        // resize-first so the snapshot lays out at its own geometry. The fit
        // then reconciles with the actual container — if that's a real change,
        // the PTY gets a SIGWINCH and the TUI repaints itself.
        term.resize(cols, rows);
        term.write(`\x1bc${data}`);
        scheduleFit();
      },
      onExit: (exitCode) => {
        term.write(`\r\n\x1b[90m[process exited with code ${String(exitCode)}]\x1b[0m\r\n`);
      },
      onStatusChange: (status) => statusRef.current?.(agentId, status),
    });
    void connection.connect();

    term.onData((data) => connection.write(data));
    registerInputRef.current?.(agentId, (data) => connection.write(data));

    // Touch scrolling. xterm handles touch drags natively only while the app
    // has NOT enabled mouse tracking — Claude Code has, so on a phone its
    // transcript can't be scrolled at all. Translate vertical drags (plus an
    // iOS-style flick after release) into synthetic wheel events dispatched
    // into xterm's own wheel pipeline, which already routes every regime
    // correctly: mouse reports to the TUI when tracking is on (Claude Code
    // scrolls its transcript), viewport scrollback when off, arrow keys on
    // the alt screen. One row-height of drag = one DOM_DELTA_LINE wheel tick,
    // exactly one desktop wheel line in every regime (pixel deltas would ride
    // xterm's measured cell height and its partial-scroll accumulator).
    // Capture-phase stopPropagation starves xterm's native touch path, which
    // would otherwise double-scroll in the tracking-off case.
    // The gesture follows ONE finger by identifier. Scrolling one-handed, the
    // palm heel or a second finger grazing the screen edge registers as an
    // extra contact — a gesture that bailed on touches.length !== 1 died the
    // moment that happened (and the graze's touchend killed it for good),
    // stalling roughly every other scroll depending on grip. Other contacts
    // are ignored entirely; only the tracked finger moves, ends, or cancels
    // the gesture.
    const flick = {
      tracking: false,
      touchId: -1,
      engaged: false,
      startY: 0,
      startT: 0,
      lastX: 0,
      lastY: 0,
      lastT: 0,
      velocity: 0,
      remainder: 0,
      frame: null as number | null,
    };
    const findTracked = (list: TouchList) => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === flick.touchId) return list[i];
      }
      return null;
    };
    const rowHeightPx = () =>
      host.clientHeight > 0 && term.rows > 0 ? host.clientHeight / term.rows : fontSizePx;
    const stopFlick = () => {
      if (flick.frame !== null) {
        cancelAnimationFrame(flick.frame);
        flick.frame = null;
      }
    };
    const emitWheelTicks = (dyPx: number) => {
      flick.remainder += dyPx;
      const rowH = rowHeightPx();
      const ticks = Math.trunc(flick.remainder / rowH);
      if (ticks === 0) return;
      flick.remainder -= ticks * rowH;
      const target = term.element?.querySelector('.xterm-screen') ?? host;
      for (let i = 0; i < Math.abs(ticks); i++) {
        target.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: Math.sign(ticks),
            deltaMode: WheelEvent.DOM_DELTA_LINE,
            clientX: flick.lastX,
            clientY: flick.lastY,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      e.stopPropagation();
      // Pre-empt iOS's long-press recognizer too: it's a NO-movement gesture,
      // so the touchmove preventDefault below can't stop it — rest a finger
      // for a beat before dragging (half of natural scrolls) and the text
      // loupe on the editable helper textarea claims the touch, fires
      // touchcancel, and the rest of the drag is dead. Nothing native is
      // wanted from terminal touches: taps focus explicitly in touchend, so
      // even the synthesized click this suppresses isn't needed.
      if (e.cancelable) e.preventDefault();
      stopFlick();
      // Already following a finger that's still down → this is an extra
      // contact (palm, second finger); ignore it. The e.touches check
      // self-heals a stale gesture whose end event never arrived.
      if (flick.tracking && findTracked(e.touches)) return;
      const t = e.changedTouches[0];
      if (!t) return;
      flick.tracking = true;
      flick.touchId = t.identifier;
      flick.engaged = false;
      flick.startY = t.clientY;
      flick.startT = e.timeStamp;
      flick.lastX = t.clientX;
      flick.lastY = t.clientY;
      flick.lastT = e.timeStamp;
      flick.velocity = 0;
      flick.remainder = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      e.stopPropagation();
      // Consume EVERY move from the first: touch-action only rules out
      // panning — iOS can still claim the drag for text selection (the loupe
      // engages on the helper textarea, an editable), which fires touchcancel
      // and kills the gesture a few px in. Nothing on a terminal needs a
      // native touch gesture, so leave Safari no opening.
      if (e.cancelable) e.preventDefault();
      if (!flick.tracking) return;
      // Only the tracked finger's motion counts; this event may be another
      // contact moving.
      const t = findTracked(e.changedTouches);
      if (!t) return;
      if (!flick.engaged) {
        // Within the tap slop it may still become a tap-to-focus; scrolling
        // starts (and taps are ruled out) only past it.
        if (Math.abs(t.clientY - flick.startY) <= TOUCH_TAP_MAX_MOVE_PX) return;
        flick.engaged = true;
        flick.lastY = t.clientY;
        flick.lastT = e.timeStamp;
        return;
      }
      const dy = flick.lastY - t.clientY;
      const dt = Math.max(1, e.timeStamp - flick.lastT);
      // Light smoothing: the release velocity comes from the last move event,
      // which is noisy on its own.
      flick.velocity = 0.8 * (dy / dt) + 0.2 * flick.velocity;
      flick.lastX = t.clientX;
      flick.lastY = t.clientY;
      flick.lastT = e.timeStamp;
      emitWheelTicks(dy);
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.stopPropagation();
      if (!flick.tracking) return;
      // A palm graze lifting must not end the real drag — only the tracked
      // finger ends the gesture.
      if (!findTracked(e.changedTouches)) return;
      flick.tracking = false;
      if (!flick.engaged) {
        // A tap. Focus explicitly instead of relying on the synthesized
        // click: preventing a wobbly tap's touchmoves above suppresses its
        // click, and losing the tap-to-summon-keyboard path is worse than
        // double-focusing on clean taps.
        if (e.timeStamp - flick.startT <= TOUCH_TAP_MAX_DURATION_MS && term.element) {
          e.preventDefault();
          term.focus();
        }
        return;
      }
      let v = flick.velocity;
      if (Math.abs(v) < TERMINAL_FLICK_MIN_VELOCITY_PX_PER_MS) return;
      let last = e.timeStamp;
      const step = (now: number) => {
        flick.frame = null;
        const dt = Math.max(1, now - last);
        last = now;
        emitWheelTicks(v * dt);
        v *= TERMINAL_FLICK_DECAY_PER_MS ** dt;
        if (Math.abs(v) >= TERMINAL_FLICK_MIN_VELOCITY_PX_PER_MS) {
          flick.frame = requestAnimationFrame(step);
        }
      };
      flick.frame = requestAnimationFrame(step);
    };
    const onTouchCancel = (e: TouchEvent) => {
      e.stopPropagation();
      if (!flick.tracking || !findTracked(e.changedTouches)) return;
      flick.tracking = false;
    };
    host.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    host.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    host.addEventListener('touchend', onTouchEnd, { capture: true });
    host.addEventListener('touchcancel', onTouchCancel, { capture: true });

    // Debounced: ResizeObserver fires per frame during a drag, and every resize
    // is a syscall on the PTY plus a full TUI repaint.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let verifyFrame: number | null = null;
    const applyFit = () => {
      // A hidden pane has zero dimensions; fit() would compute a nonsense size
      // and resize the PTY to it.
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      // Deferred open: xterm measures its cell grid the moment open() runs,
      // and this pane mounts inside a display:none panel (App only flips the
      // drawer open in an effect that runs after ours). Measuring while
      // hidden records garbage cell metrics that poison the first visible
      // fit() — the terminal squeezed into a ~10-column strip until the user
      // jiggles the container. Opening on the first fit that sees real
      // dimensions measures against real layout instead. Output that arrived
      // before open (the scrollback replay) is buffered by xterm and flushed
      // here.
      if (!term.element) {
        term.open(host);
        if (autoFocus) term.focus();
      }
      try {
        fit.fit();
        connection.resize(term.cols, term.rows);
      } catch {
        // fit() throws if the element is mid-teardown; the next tick recovers.
      }
      // Self-heal: one frame later, if the grid no longer matches what the
      // host's dimensions call for (metrics re-measured, layout shifted under
      // us), fit again rather than waiting for a user resize. Converges: fit()
      // applies exactly the proposal, so a stable layout passes this check on
      // the next pass and stops rescheduling.
      if (verifyFrame !== null) cancelAnimationFrame(verifyFrame);
      verifyFrame = requestAnimationFrame(() => {
        verifyFrame = null;
        const proposed = fit.proposeDimensions();
        if (proposed && (proposed.cols !== term.cols || proposed.rows !== term.rows)) {
          applyFit();
        }
      });
    };
    const scheduleFit = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyFit, TERMINAL_RESIZE_DEBOUNCE_MS);
    };

    const observer = new ResizeObserver(scheduleFit);
    observer.observe(host);
    applyFit();

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      if (verifyFrame !== null) cancelAnimationFrame(verifyFrame);
      stopFlick();
      host.removeEventListener('touchstart', onTouchStart, { capture: true });
      host.removeEventListener('touchmove', onTouchMove, { capture: true });
      host.removeEventListener('touchend', onTouchEnd, { capture: true });
      host.removeEventListener('touchcancel', onTouchCancel, { capture: true });
      observer.disconnect();
      registerInputRef.current?.(agentId, null);
      connection.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [agentId, fontSizePx, autoFocus]);

  // Becoming visible: the pane had no dimensions while hidden, so re-fit and
  // focus now that it does.
  useEffect(() => {
    if (!isActive) return;
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // Not laid out yet; the ResizeObserver will catch up.
      }
      // The terminal opens lazily on its first visible fit (see the mount
      // effect), so it may not be attached yet — that first fit also focuses.
      //
      // Beyond autoFocus: if the user was typing in ANOTHER pane's terminal
      // when this one became active (mobile: card tap while the keyboard is
      // up), steal the focus. Moving focus input-to-input keeps the iOS
      // keyboard open, where blur-then-nothing would dismiss it.
      const active = document.activeElement;
      const typingInOtherTerminal =
        active instanceof HTMLElement &&
        active.classList.contains('xterm-helper-textarea') &&
        !hostRef.current?.contains(active);
      if ((autoFocus || typingInOtherTerminal) && termRef.current?.element) {
        termRef.current.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [isActive, autoFocus]);

  return (
    // touch-none: no native pan may ever start on the terminal — with the iOS
    // keyboard up a vertical drag pans the whole page (overflow:hidden does
    // not apply to viewport panning), and once Safari claims the gesture the
    // touchmove preventDefault above arrives too late. All touch scrolling
    // here is synthesized into wheel events instead.
    <div
      ref={hostRef}
      className="w-full h-full touch-none"
      style={
        {
          display: isActive ? '' : 'none',
          // Consumed by the `.xterm, .xterm *` rule in index.css to beat the
          // global `* { font-pixel }` base rule. Fed from the same constant
          // xterm measures its cell grid with, so CSS can't drift from metrics.
          '--font-terminal': TERMINAL_FONT_FAMILY,
        } as CSSProperties
      }
    />
  );
}
