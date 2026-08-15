import { useCallback, useEffect, useRef, useState } from 'react';

//
// Transient status messages.
//
// Results used to sit in a banner pinned above the content, which pushed the page down
// and stayed until dismissed. A toast rises from the bottom instead, fades out on its
// own, and takes no layout space — the message matters for a moment, the UI beneath it
// matters for the rest of the session.
//

const SuccessMs = 3000;
// Failures get longer: they are usually worth reading, and often worth acting on
const ErrorMs = 7000;
// Must match the fade-out in index.css, so the node is removed once it's invisible
const FadeMs = 260;

export type ToastKind = 'status' | 'error';

interface ToastState {
    kind: ToastKind;
    message: string;
    leaving: boolean;
}

export interface ToastApi {
    show: (kind: ToastKind, message: string) => void;
    dismiss: () => void;
}

// Owns the current toast and its timers. `show` is stable, so callers can hold onto it.
export function useToast(): [ToastState | null, ToastApi] {
    const [toast, setToast] = useState<ToastState | null>(null);
    const hideTimer = useRef<number | undefined>(undefined);
    const removeTimer = useRef<number | undefined>(undefined);

    const clearTimers = (): void => {
        window.clearTimeout(hideTimer.current);
        window.clearTimeout(removeTimer.current);
    };

    useEffect(() => clearTimers, []);

    const show = useCallback((kind: ToastKind, message: string) => {
        clearTimers();

        setToast({ kind, message, leaving: false });

        // Fade, then unmount. A repeat message simply restarts these timers, so a
        // failing 5s poll re-arms one toast rather than stacking up a queue of them.
        hideTimer.current = window.setTimeout(() => {
            setToast(current => (current ? { ...current, leaving: true } : null));

            removeTimer.current = window.setTimeout(() => setToast(null), FadeMs);
        }, kind === 'error' ? ErrorMs : SuccessMs);
    }, []);

    // Tapping a toast fades it out early rather than snapping it away
    const dismiss = useCallback(() => {
        clearTimers();

        setToast(current => (current ? { ...current, leaving: true } : null));

        removeTimer.current = window.setTimeout(() => setToast(null), FadeMs);
    }, []);

    return [toast, { show, dismiss }];
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
    if (!toast) {
        return null;
    }

    return (
        <div className="toast-layer" role="status" aria-live="polite">
            <button
                className={`toast ${toast.kind}${toast.leaving ? ' leaving' : ''}`}
                onClick={onDismiss}
                title="Dismiss"
            >
                {toast.message}
            </button>
        </div>
    );
}
