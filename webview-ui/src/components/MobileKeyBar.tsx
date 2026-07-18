import { MOBILE_KEY_BAR_KEYS } from '../constants.js';

interface MobileKeyBarProps {
  /** Writes the key's byte sequence to the active terminal's PTY. */
  onKey: (sequence: string) => void;
}

/**
 * Accessory key row shown above the software keyboard in terminal view. The
 * iOS form-assistant bar (prev/next arrows + Done) is WebKit chrome that web
 * content cannot alter or remove, so this row sits directly above it and
 * supplies the keys a Claude Code TUI actually needs — slash menu, shift+tab
 * mode cycle, esc interrupt — none of which exist on the iOS keyboard.
 */
export function MobileKeyBar({ onKey }: MobileKeyBarProps) {
  return (
    <div className="shrink-0 flex items-stretch gap-6 px-8 py-6 bg-bg border-t-2 border-border">
      {MOBILE_KEY_BAR_KEYS.map(({ label, sequence }) => (
        <button
          key={label}
          // preventDefault on touchend swallows the synthesized mousedown that
          // would blur the terminal's textarea and dismiss the keyboard — the
          // key is sent here and the suppressed click never fires.
          onTouchEnd={(e) => {
            e.preventDefault();
            onKey(sequence);
          }}
          // Mouse path (desktop emulation): block the focus steal on mousedown,
          // send on click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onKey(sequence)}
          className="flex-1 bg-btn-bg border-2 border-border rounded-none text-text text-sm leading-none py-8 cursor-pointer active:bg-btn-hover"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
