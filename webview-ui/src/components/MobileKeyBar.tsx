import type { TouchEvent as ReactTouchEvent } from 'react';
import { useRef } from 'react';

import { MOBILE_KEY_BAR_KEYS, TOUCH_TAP_MAX_MOVE_PX } from '../constants.js';

interface MobileKeyBarProps {
  /** Writes the key's byte sequence to the active terminal's PTY. */
  onKey: (sequence: string) => void;
  /** Reads the clipboard and pastes it into the active terminal. */
  onPaste: () => void;
}

/**
 * Accessory key row shown above the software keyboard in terminal view. The
 * iOS form-assistant bar (prev/next arrows + Done) is WebKit chrome that web
 * content cannot alter or remove, so this row sits directly above it and
 * supplies the keys a Claude Code TUI actually needs — slash menu, shift+tab
 * mode cycle, esc interrupt, menu arrows — none of which exist on the iOS
 * keyboard.
 */
export function MobileKeyBar({ onKey, onPaste }: MobileKeyBarProps) {
  // The bar scrolls horizontally when the keys outgrow a narrow screen, so a
  // touch only counts as a key press if it didn't travel — otherwise the
  // release of a scroll-drag would fire whatever key it happened to end on.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const onKeyTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const endedAsTap = (e: ReactTouchEvent) => {
    const s = touchStartRef.current;
    const t = e.changedTouches[0];
    return (
      s !== null &&
      t !== undefined &&
      Math.abs(t.clientX - s.x) <= TOUCH_TAP_MAX_MOVE_PX &&
      Math.abs(t.clientY - s.y) <= TOUCH_TAP_MAX_MOVE_PX
    );
  };
  // min-w-fit keeps labels from squishing; flex-1 stretches the keys to fill
  // when there is room.
  const keyClass =
    'flex-1 min-w-fit whitespace-nowrap bg-btn-bg border-2 border-border rounded-none text-text text-sm leading-none py-8 px-10 cursor-pointer active:bg-btn-hover';
  return (
    // touch-pan-x: keys are tap-only but the ROW may pan horizontally on
    // screens too narrow for all keys; vertical drags still must not pan the
    // page (iOS pans the layout viewport while the keyboard is up), which
    // pan-x alone already rules out.
    <div className="shrink-0 flex items-stretch gap-6 px-8 py-6 bg-bg border-t-2 border-border overflow-x-auto touch-pan-x">
      {MOBILE_KEY_BAR_KEYS.map(({ label, sequence }) => (
        <button
          key={label}
          onTouchStart={onKeyTouchStart}
          // preventDefault on touchend swallows the synthesized mousedown that
          // would blur the terminal's textarea and dismiss the keyboard — the
          // key is sent here and the suppressed click never fires.
          onTouchEnd={(e) => {
            e.preventDefault();
            if (endedAsTap(e)) onKey(sequence);
          }}
          // Mouse path (desktop emulation): block the focus steal on mousedown,
          // send on click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onKey(sequence)}
          className={keyClass}
        >
          {label}
        </button>
      ))}
      <button
        onTouchStart={onKeyTouchStart}
        // Same two-path pattern as the keys. Reading the clipboard inside the
        // touchend handler keeps the user activation iOS requires; Safari may
        // still surface its paste-permission callout the first time.
        onTouchEnd={(e) => {
          e.preventDefault();
          if (endedAsTap(e)) onPaste();
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPaste()}
        className={keyClass}
      >
        paste
      </button>
    </div>
  );
}
