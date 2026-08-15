import { useEffect } from 'react';

//
// Press highlighting for every button in the app, installed once from App.
//
// Scrolling comes first: a finger dragged across the screen must pan the page even when
// it starts on a button, and must never activate it. So this module does NOT drive
// activation — the browser's own click does, and the browser already cancels that click
// when the touch turns into a scroll. All we add is the visual: a subtle highlight while
// a finger genuinely rests on a button, dropped the moment the touch starts to travel.
//
// (An earlier version claimed the gesture with `touch-action: none` and synthesized
// clicks from pointerup. It made taps reliable but stopped drags that began on a button
// from scrolling, and lit buttons up as a finger swept past them.)
//

// A quick tap would otherwise flash for only a few milliseconds
const MinPressMs = 140;

// Travel beyond this is a scroll, not a press: drop the highlight and let it go
const SlopPx = 10;

export function usePressFeedback(): void {
    useEffect(() => {
        let target: HTMLButtonElement | undefined;
        let startX = 0;
        let startY = 0;
        let pressedAt = 0;

        const release = (element: HTMLButtonElement, held: number): void => {
            window.setTimeout(() => element.classList.remove('is-pressed'), Math.max(0, MinPressMs - held));
        };

        const onPointerDown = (event: PointerEvent): void => {
            if (!event.isPrimary) {
                return;
            }

            const button = (event.target as HTMLElement | null)?.closest('button');
            if (!button || button.disabled) {
                return;
            }

            target = button;
            startX = event.clientX;
            startY = event.clientY;
            pressedAt = performance.now();

            button.classList.add('is-pressed');
        };

        const onPointerMove = (event: PointerEvent): void => {
            if (!target) {
                return;
            }

            if (Math.hypot(event.clientX - startX, event.clientY - startY) > SlopPx) {
                target.classList.remove('is-pressed');
                target = undefined;
            }
        };

        const onPointerEnd = (): void => {
            if (target) {
                release(target, performance.now() - pressedAt);
                target = undefined;
            }
        };

        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerEnd, true);
        document.addEventListener('pointercancel', onPointerEnd, true);

        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('pointermove', onPointerMove, true);
            document.removeEventListener('pointerup', onPointerEnd, true);
            document.removeEventListener('pointercancel', onPointerEnd, true);
        };
    }, []);
}
