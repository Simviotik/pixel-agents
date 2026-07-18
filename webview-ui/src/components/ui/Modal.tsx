import type { ReactNode } from 'react';

import { Button } from './Button.js';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** z-index for backdrop (modal gets +1). Default 49 */
  zIndex?: number;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  zIndex = 50,
  className = '',
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50" style={{ zIndex }} onClick={onClose} />
      {/* Viewport caps + scroll: phone-width screens are narrower than what
          the content (22px pixel font rows) wants, so the panel clamps to the
          viewport with an 8px margin and scrolls vertically instead of
          overflowing off both edges. */}
      <div
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg border-2 border-border rounded-none shadow-pixel p-4 min-w-xs max-w-[calc(100dvw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto overflow-x-hidden ${className}`}
        style={{ zIndex: zIndex + 1 }}
      >
        {/* Sticky so the close button stays reachable while long content
            (changelog, settings) scrolls under it. */}
        <div className="sticky top-0 z-10 bg-bg flex items-center justify-between py-4 px-10 border-b border-border mb-4">
          <span className="text-accent-bright text-2xl">{title}</span>
          <Button variant="ghost" size="icon" onClick={onClose}>
            x
          </Button>
        </div>
        {children}
      </div>
    </>
  );
}
