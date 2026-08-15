import { useEffect } from 'react';

//
// Touch/press behavior for every button in the app, installed once from App.
//
// Two problems this solves on a touch screen:
//
//  1. No feedback. `:hover` never applies to a finger and `:active` disappears the
//     instant the finger lifts, so a tap looked like nothing happened — especially for
//     a scene activate, where the real result (lights changing) is seconds away. Every
//     press now gets an inverted `.is-pressed` state held for at least MinPressMs.
//
//  2. Taps turning into scrolls. Combined with `touch-action: none` on controls (see
//     index.css), a touch starting on a button can no longer pan the page. The browser
//     still cancels its own click if the finger drifts even slightly, so activation is
//     driven from pointerup here with a much more forgiving slop radius, and the
//     browser's late click (if it comes) is swallowed so nothing fires twice.
//
// Mouse and keyboard keep the native click path untouched.
//

// How long the inverted state stays up, even for a quick tap. Long enough to read as
// "that registered" without feeling laggy.
const MinPressMs = 350;

// How far a finger may travel and still count as a tap. The browser's own threshold is
// roughly 10px, which is what made presses feel unreliable at a wall panel.
const SlopPx = 30;

// A browser-generated click arriving after our own is a duplicate; ignore clicks on a
// button for this long after we activated it ourselves.
const DuplicateClickWindowMs = 700;

export function usePressFeedback(): void {
    useEffect(() => {
        let target: HTMLButtonElement | undefined;
        let startX = 0;
        let startY = 0;
        let pressedAt = 0;
        let cancelled = false;

        // True only while we are dispatching our own click, so the capture-phase guard
        // below can tell our click apart from the browser's duplicate
        let dispatching = false;
        let suppressClicksUntil = 0;
        let suppressTarget: HTMLButtonElement | undefined;

        const releaseVisual = (element: HTMLElement, held: number): void => {
            const remaining = Math.max(0, MinPressMs - held);

            window.setTimeout(() => element.classList.remove('is-pressed'), remaining);
        };

        const clear = (): void => {
            target = undefined;
            cancelled = false;
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
            cancelled = false;

            button.classList.add('is-pressed');
        };

        const onPointerMove = (event: PointerEvent): void => {
            if (!target || cancelled) {
                return;
            }

            const travelled = Math.hypot(event.clientX - startX, event.clientY - startY);
            if (travelled > SlopPx) {
                cancelled = true;

                target.classList.remove('is-pressed');
            }
        };

        const onPointerUp = (event: PointerEvent): void => {
            const button = target;
            if (!button) {
                return;
            }

            const held = performance.now() - pressedAt;

            releaseVisual(button, held);

            // Touch/pen only: the mouse path already delivers a reliable click, and
            // taking it over here would just risk double activation
            if (!cancelled && event.pointerType !== 'mouse' && !button.disabled) {
                dispatching = true;
                button.click();
                dispatching = false;

                suppressClicksUntil = performance.now() + DuplicateClickWindowMs;
                suppressTarget = button;
            }

            clear();
        };

        const onPointerCancel = (): void => {
            if (target) {
                releaseVisual(target, performance.now() - pressedAt);
            }

            clear();
        };

        // Swallow the browser's own click for a button we just activated ourselves
        const onClickCapture = (event: MouseEvent): void => {
            if (dispatching) {
                return;
            }

            const button = (event.target as HTMLElement | null)?.closest('button');
            if (!button || button !== suppressTarget || performance.now() > suppressClicksUntil) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
        };

        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('pointercancel', onPointerCancel, true);
        document.addEventListener('click', onClickCapture, true);

        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('pointermove', onPointerMove, true);
            document.removeEventListener('pointerup', onPointerUp, true);
            document.removeEventListener('pointercancel', onPointerCancel, true);
            document.removeEventListener('click', onClickCapture, true);
        };
    }, []);
}
