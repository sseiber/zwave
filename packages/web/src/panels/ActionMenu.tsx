import { useEffect, useRef, useState } from 'react';

//
// The subtle per-view actions menu that replaced the prominent "New …" button in each
// panel header. A view's actions collect here — "New scene" today, whatever a view
// grows later — so the header stays quiet and one control covers them all.
//

export interface MenuItem {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    // Secondary line under the label, for actions whose effect isn't obvious
    hint?: string;
}

interface ActionMenuProps {
    items: MenuItem[];
    // Accessible name for the trigger; the trigger itself is just the kebab glyph
    label?: string;
}

export function ActionMenu({ items, label = 'Actions' }: ActionMenuProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);

    // Close on a press outside the menu, or on Escape
    useEffect(() => {
        if (!open) {
            return;
        }

        const onPointerDown = (event: PointerEvent): void => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    if (items.length === 0) {
        return null;
    }

    return (
        <div className="action-menu" ref={rootRef}>
            <button
                className="action-menu-trigger"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={label}
                title={label}
                onClick={() => setOpen(current => !current)}
            >
                <span className="kebab" aria-hidden="true" />
            </button>

            {open && (
                <div className="action-menu-list" role="menu">
                    {items.map(item => (
                        <button
                            key={item.label}
                            role="menuitem"
                            className="action-menu-item"
                            disabled={item.disabled}
                            onClick={() => {
                                setOpen(false);
                                item.onSelect();
                            }}
                        >
                            <span>{item.label}</span>
                            {item.hint && <span className="muted action-menu-hint">{item.hint}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
