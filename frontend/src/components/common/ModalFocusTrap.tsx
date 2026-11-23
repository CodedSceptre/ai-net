import { cloneElement, useRef, type ReactElement, type Ref } from 'react';
import FocusTrap from 'focus-trap-react';

interface Props {
  children: ReactElement<{ tabIndex?: number }>;
  onEscape?: () => void;
}

export default function ModalFocusTrap({ children, onEscape }: Props) {
  const container = useRef<HTMLElement | null>(null);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  const childRef = (children as ReactElement & { ref?: Ref<HTMLElement> }).ref;

  return (
    <FocusTrap focusTrapOptions={{
      allowOutsideClick: (event: MouseEvent | TouchEvent) =>
        event.target instanceof Element && event.target.hasAttribute('data-modal-backdrop'),
      delayInitialFocus: false,
      escapeDeactivates: () => {
        escape.current?.();
        return false;
      },
      fallbackFocus: () => container.current!,
      tabbableOptions: {
        displayCheck: import.meta.env.MODE === 'test' ? 'none' : 'full',
      },
    }}>
      {cloneElement(children as ReactElement<{ ref?: Ref<HTMLElement>; tabIndex?: number }>, {
        tabIndex: -1,
        ref: (node) => {
          container.current = node;
          if (typeof childRef === 'function') childRef(node);
          else if (childRef) (childRef as { current: HTMLElement | null }).current = node;
        },
      })}
    </FocusTrap>
  );
}
