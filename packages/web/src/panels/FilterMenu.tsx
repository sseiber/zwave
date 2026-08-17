import { useEffect, useRef, useState } from 'react';

//
// A classic filter dropdown: a fixed set of checkboxes that is always the same, so the
// control never rearranges itself under the user's finger. Only the counts beside each
// option move as devices change state.
//
// Semantics are the conventional ones: options within a group are OR'd (On *or* Off),
// and groups are AND'd (a dimmer *and* currently on).
//

export interface FilterOption<T> {
    key: string;
    label: string;
    group: string;
    matches: (item: T) => boolean;
}

interface FilterMenuProps<T> {
    options: FilterOption<T>[];
    items: T[];
    selected: string[];
    onChange: (selected: string[]) => void;
}

export function FilterMenu<T>({ options, items, selected, onChange }: FilterMenuProps<T>) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);

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

    const groups = [...new Set(options.map(option => option.group))];

    const toggle = (key: string): void => {
        onChange(selected.includes(key) ? selected.filter(entry => entry !== key) : [...selected, key]);
    };

    return (
        <div className="filter-menu" ref={rootRef}>
            <button
                className={`filter-trigger${selected.length > 0 ? ' active' : ''}`}
                aria-haspopup="true"
                aria-expanded={open}
                onClick={() => setOpen(current => !current)}
            >
                <span className="funnel" aria-hidden="true" />
                Filter
                {selected.length > 0 && <span className="filter-count">{selected.length}</span>}
            </button>

            {open && (
                <div className="filter-panel">
                    {groups.map(group => (
                        <fieldset key={group} className="filter-group">
                            <legend>{group}</legend>
                            {options.filter(option => option.group === group).map((option) => {
                                const count = items.filter(option.matches).length;

                                return (
                                    <label key={option.key} className="filter-option">
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(option.key)}
                                            onChange={() => toggle(option.key)}
                                        />
                                        <span className="filter-option-label">{option.label}</span>
                                        <span className="muted filter-option-count">{count}</span>
                                    </label>
                                );
                            })}
                        </fieldset>
                    ))}

                    <div className="filter-actions">
                        <button className="link-btn" onClick={() => onChange([])} disabled={selected.length === 0}>Clear all</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Apply a selection: OR within a group, AND across groups. An empty selection matches
// everything.
export function applyFilters<T>(items: T[], options: FilterOption<T>[], selected: string[]): T[] {
    if (selected.length === 0) {
        return items;
    }

    const chosen = options.filter(option => selected.includes(option.key));
    const groups = [...new Set(chosen.map(option => option.group))];

    return items.filter(item => groups.every(group => chosen
        .filter(option => option.group === group)
        .some(option => option.matches(item))));
}
