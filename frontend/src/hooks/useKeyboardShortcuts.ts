import { useEffect } from 'react';

export interface ShortcutConfig {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  description: string;
  action: () => void;
}

export type ShortcutsMap = Record<string, ShortcutConfig>;

/**
 * Registers global keydown shortcuts and removes them on unmount.
 *
 * Shortcuts are skipped when focus is inside an input, textarea, or
 * contenteditable element so that normal typing is never intercepted.
 */
export function useKeyboardShortcuts(
  shortcuts: ShortcutsMap,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when the user is typing in a form field or rich-text area.
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      for (const config of Object.values(shortcuts)) {
        const keyMatches = e.key.toLowerCase() === config.key.toLowerCase();
        const metaMatches = config.meta ? e.metaKey : !e.metaKey;
        const ctrlMatches = config.ctrl ? e.ctrlKey : !e.ctrlKey;
        const shiftMatches = config.shift ? e.shiftKey : !e.shiftKey;

        if (keyMatches && metaMatches && ctrlMatches && shiftMatches) {
          e.preventDefault();
          config.action();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);
}
