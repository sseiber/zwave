import { useState } from 'react';
import type { IDeviceInfo, IRoom, IScene, ISceneDevice, ISceneStatus, ISchedule } from '@zwave-service/contracts';
import { DeviceAction, DeviceType, ScheduleKind } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';
import { defaultSchedule, describeSchedule } from '../schedule.ts';
import { relativeTime, relativeUpcoming, absoluteTime } from '../format.ts';
import { ActionMenu } from './ActionMenu.tsx';
import { SchedulePicker } from './SchedulePicker.tsx';

interface ScenesPanelProps {
    scenes: IScene[];
    statuses: ISceneStatus[];
    rooms: IRoom[];
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
    refreshStatus: () => Promise<void>;
    // Activating a scene changes device state, so the device list needs re-reading too
    refreshDevices: () => Promise<void>;
}

type Editing = IScene | 'new' | null;

export function ScenesPanel({ scenes, statuses, rooms, devices, run, refresh, refreshStatus, refreshDevices }: ScenesPanelProps) {
    const [editing, setEditing] = useState<Editing>(null);
    // Which scene has its details expanded (at most one, so the list stays scannable)
    const [openId, setOpenId] = useState<string | null>(null);
    // Per-scene activation feedback: the tile says "Activating…" then "Activated"
    const [busyId, setBusyId] = useState<string | null>(null);
    const [ranId, setRanId] = useState<string | null>(null);

    const statusById = new Map(statuses.map(s => [s.sceneId, s]));

    const activate = async (scene: IScene): Promise<void> => {
        setBusyId(scene.id);

        try {
            const ok = await run(() => api.activateScene(scene.id));

            await refresh();
            await refreshStatus();
            await refreshDevices();

            if (ok) {
                setRanId(scene.id);
                window.setTimeout(() => setRanId(current => (current === scene.id ? null : current)), ActivatedFlashMs);
            }
        }
        finally {
            setBusyId(current => (current === scene.id ? null : current));
        }
    };

    const remove = async (scene: IScene): Promise<void> => {
        if (!confirm(`Delete scene “${scene.name}”?`)) {
            return;
        }
        if (await run(() => api.deleteScene(scene.id))) {
            await refresh();
        }
    };

    const save = async (name: string, roomId: string | undefined, schedules: ISchedule[] | undefined, sceneDevices: ISceneDevice[]): Promise<void> => {
        const ok = editing === 'new'
            ? await run(() => api.createScene({ name, roomId, schedules, devices: sceneDevices }), `Scene “${name}” created`)
            : await run(() => api.updateScene((editing as IScene).id, { name, roomId, schedules, devices: sceneDevices }), `Scene “${name}” updated`);

        if (ok) {
            setEditing(null);
            await refresh();
        }
    };

    const groups = groupScenesByRoom(scenes, rooms);

    return (
        <section>
            <div className="panel-head">
                <h2>Scenes</h2>
                <ActionMenu
                    label="Scene actions"
                    items={[{
                        label: 'New scene',
                        onSelect: () => setEditing('new'),
                        disabled: editing !== null || devices.length === 0,
                        hint: devices.length === 0 ? 'include a device first' : undefined
                    }]}
                />
            </div>

            {devices.length === 0 && (
                <p className="muted">A scene controls devices — include a device first, then come back.</p>
            )}

            {editing && (
                <SceneForm
                    scene={editing === 'new' ? undefined : editing}
                    rooms={rooms}
                    devices={devices}
                    onCancel={() => setEditing(null)}
                    onSave={save}
                />
            )}

            {scenes.length === 0 && !editing && devices.length > 0
                ? <p className="muted">No scenes yet. Create one to set several devices at once — across any rooms.</p>
                : groups.map(group => (
                    <div key={group.key} className="scene-group">
                        <h3 className="scene-group-head">{group.label}</h3>
                        <ul className="scene-tiles">
                            {group.scenes.map(scene => (
                                <SceneTile
                                    key={scene.id}
                                    scene={scene}
                                    status={statusById.get(scene.id)}
                                    devices={devices}
                                    busy={busyId === scene.id}
                                    justRan={ranId === scene.id}
                                    open={openId === scene.id}
                                    onActivate={() => void activate(scene)}
                                    onToggleDetails={() => setOpenId(current => (current === scene.id ? null : scene.id))}
                                    onEdit={() => setEditing(scene)}
                                    onDelete={() => void remove(scene)}
                                />
                            ))}
                        </ul>
                    </div>
                ))}
        </section>
    );
}

// How long a tile shows "Activated" after a successful run
const ActivatedFlashMs = 2500;

interface SceneGroup {
    key: string;
    label: string;
    scenes: IScene[];
}

// Group scenes under their room label, in the room list's own order, with anything
// unlabelled (a catch-all like "House off") collected at the end. `roomId` is only a
// label — it does not constrain which devices a scene controls.
export function groupScenesByRoom(scenes: IScene[], rooms: IRoom[]): SceneGroup[] {
    const groups: SceneGroup[] = [];
    const placed = new Set<string>();

    for (const room of rooms) {
        const members = scenes.filter(scene => scene.roomId === room.id);

        members.forEach(scene => placed.add(scene.id));

        if (members.length > 0) {
            groups.push({ key: room.id, label: room.name, scenes: members });
        }
    }

    const rest = scenes.filter(scene => !placed.has(scene.id));
    if (rest.length > 0) {
        groups.push({ key: '__unassigned__', label: rooms.length > 0 ? 'No room' : 'All scenes', scenes: rest });
    }

    return groups;
}

interface SceneTileProps {
    scene: IScene;
    status: ISceneStatus | undefined;
    devices: IDeviceInfo[];
    busy: boolean;
    justRan: boolean;
    open: boolean;
    onActivate: () => void;
    onToggleDetails: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

// The tile itself is the Activate button — the name is the target, and everything
// else (device list, schedules, edit/delete) hides behind the details toggle.
function SceneTile({ scene, status, devices, busy, justRan, open, onActivate, onToggleDetails, onEdit, onDelete }: SceneTileProps) {
    const meta = busy
        ? 'Activating…'
        : justRan
            ? 'Activated'
            : tileMeta(scene, status);

    return (
        <li className={`scene-tile-wrap${open ? ' open' : ''}`}>
            <div className="scene-tile">
                <button
                    className={`scene-run${justRan ? ' ran' : ''}`}
                    onClick={onActivate}
                    disabled={busy}
                    title={`Activate ${scene.name}`}
                >
                    <span className="scene-run-name">{scene.name}</span>
                    <span className="scene-run-meta">{meta}</span>
                </button>

                <button
                    className="scene-details-toggle"
                    onClick={onToggleDetails}
                    aria-expanded={open}
                    aria-label={`${open ? 'Hide' : 'Show'} details for ${scene.name}`}
                    title="Details"
                >
                    <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true" />
                </button>
            </div>

            {open && (
                <div className="scene-details">
                    <SceneRunTimes scene={scene} status={status} />

                    {(scene.schedules?.length ?? 0) > 0 && (
                        <p className="muted scene-details-rules">
                            {scene.schedules?.map(describeSchedule).join(' · ')}
                        </p>
                    )}

                    <ul className="scene-actions">
                        {scene.devices.map(d => (
                            <li key={d.deviceId}>
                                {deviceName(devices, d.deviceId)} → <strong>{describeAction(d)}</strong>
                            </li>
                        ))}
                    </ul>

                    <div className="controls">
                        <button onClick={onEdit}>Edit</button>
                        <button className="danger" onClick={onDelete}>Delete</button>
                    </div>
                </div>
            )}
        </li>
    );
}

// The one line under a scene name: how many devices it sets, and its next run if it
// has one. Deliberately short — the full picture is behind the details toggle.
function tileMeta(scene: IScene, status: ISceneStatus | undefined): string {
    const parts = [`${scene.devices.length} device${scene.devices.length === 1 ? '' : 's'}`];

    if (status?.nextRun) {
        parts.push(`next ${relativeUpcoming(status.nextRun)}`);
    }
    else if ((scene.schedules?.length ?? 0) > 0) {
        parts.push('not scheduled');
    }

    return parts.join(' · ');
}

function SceneRunTimes({ scene, status }: { scene: IScene; status: ISceneStatus | undefined }) {
    const showNext = (scene.schedules?.length ?? 0) > 0;
    const hasLast = Boolean(status?.lastRun);

    // Scheduled scenes always show a "Next" (even if unplanned); scenes without
    // schedules only appear here once they've been activated at least once.
    if (!showNext && !hasLast) {
        return null;
    }

    return (
        <div className="run-times">
            {showNext && (
                <span title={absoluteTime(status?.nextRun)}>
                    Next <strong>{status?.nextRun ? relativeUpcoming(status.nextRun) : 'not scheduled'}</strong>
                </span>
            )}
            {hasLast && (
                <span title={absoluteTime(status?.lastRun)}>
                    Last <strong>{relativeTime(status?.lastRun)}</strong>
                    {status?.lastResult && !status.lastResult.succeeded && (
                        <span className="run-failed" title={status.lastResult.message}> · failed</span>
                    )}
                </span>
            )}
        </div>
    );
}

function describeAction(device: ISceneDevice): string {
    return device.action === DeviceAction.Dim ? `dim ${device.level ?? 0}%` : device.action;
}

function deviceName(devices: IDeviceInfo[], nodeId: number): string {
    const device = devices.find(d => d.nodeId === nodeId);
    return device ? (device.name || `Node ${device.nodeId}`) : `Node ${nodeId} (missing)`;
}

interface SceneFormProps {
    scene?: IScene;
    rooms: IRoom[];
    devices: IDeviceInfo[];
    onCancel: () => void;
    onSave: (name: string, roomId: string | undefined, schedules: ISchedule[] | undefined, devices: ISceneDevice[]) => Promise<void>;
}

interface DeviceGroup {
    key: string;
    label: string;
    devices: IDeviceInfo[];
}

// Group every device under a room heading (plus an "Unassigned" bucket) so a scene
// can pick across rooms. Each device appears once, under the first room that lists it.
export function groupDevicesByRoom(devices: IDeviceInfo[], rooms: IRoom[]): DeviceGroup[] {
    const placed = new Set<number>();
    const groups: DeviceGroup[] = [];

    for (const room of rooms) {
        const members = room.deviceIds
            .map(id => devices.find(d => d.nodeId === id))
            .filter((d): d is IDeviceInfo => d !== undefined && !placed.has(d.nodeId));

        members.forEach(d => placed.add(d.nodeId));

        if (members.length > 0) {
            groups.push({ key: room.id, label: room.name, devices: members });
        }
    }

    const unassigned = devices.filter(d => !placed.has(d.nodeId));
    if (unassigned.length > 0) {
        groups.push({ key: '__unassigned__', label: 'Unassigned', devices: unassigned });
    }

    return groups;
}

interface SelectedState {
    action: DeviceAction;
    level: number;
}

function SceneForm({ scene, rooms, devices, onCancel, onSave }: SceneFormProps) {
    const [name, setName] = useState(scene?.name ?? '');
    const [roomId, setRoomId] = useState(scene?.roomId ?? '');
    const [schedules, setSchedules] = useState<ISchedule[]>(scene?.schedules ?? []);
    const [selected, setSelected] = useState<Record<number, SelectedState>>(() => {
        const initial: Record<number, SelectedState> = {};
        scene?.devices.forEach(d => {
            initial[d.deviceId] = { action: d.action, level: d.level ?? 50 };
        });
        return initial;
    });

    // Every device on the controller, grouped by room — a scene is not scoped to a room
    const groups = groupDevicesByRoom(devices, rooms);

    // Rooms start collapsed unless the scene already sets something in them, so editing
    // a two-device scene is a short form rather than a scroll past every device in the
    // house. The groups themselves never move: same rooms, same order, open or shut —
    // only the count beside a room and its own open state change.
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        groups.forEach(group => {
            initial[group.key] = group.devices.some(device => scene?.devices.some(d => d.deviceId === device.nodeId));
        });
        return initial;
    });

    const toggle = (device: IDeviceInfo): void => {
        setSelected(current => {
            if (current[device.nodeId]) {
                const next = { ...current };
                delete next[device.nodeId];
                return next;
            }
            return { ...current, [device.nodeId]: { action: DeviceAction.On, level: 50 } };
        });
    };

    const update = (nodeId: number, patch: Partial<SelectedState>): void => {
        setSelected(current => ({ ...current, [nodeId]: { ...current[nodeId], ...patch } }));
    };

    const addSchedule = (): void => setSchedules(current => [...current, defaultSchedule(ScheduleKind.Daily)]);
    const removeSchedule = (index: number): void => setSchedules(current => current.filter((_, i) => i !== index));
    const updateSchedule = (index: number, next: ISchedule): void =>
        setSchedules(current => current.map((s, i) => (i === index ? next : s)));

    const canSave = name.trim().length > 0 && Object.keys(selected).length > 0;

    const submit = (): void => {
        const sceneDevices: ISceneDevice[] = Object.entries(selected).map(([id, state]) => ({
            deviceId: Number(id),
            action: state.action,
            ...(state.action === DeviceAction.Dim ? { level: state.level } : {})
        }));

        void onSave(name.trim(), roomId || undefined, schedules.length ? schedules : undefined, sceneDevices);
    };

    return (
        <form
            className="card form"
            onSubmit={e => {
                e.preventDefault();
                if (canSave) {
                    submit();
                }
            }}
        >
            <h3>{scene ? `Edit “${scene.name}”` : 'New scene'}</h3>

            <label>
                <span>Name</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Movie night" autoFocus />
            </label>

            <label>
                <span>Room <span className="muted">(label)</span></span>
                <select value={roomId} onChange={e => setRoomId(e.target.value)}>
                    <option value="">No room</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
            </label>

            <fieldset className="schedules">
                <legend>Schedules</legend>
                {schedules.length === 0
                    ? <p className="muted hint">No schedules — this scene runs only when you activate it.</p>
                    : schedules.map((s, index) => (
                        <div key={index} className="schedule-entry">
                            <div className="schedule-entry-head">
                                <span>Schedule {index + 1}</span>
                                <button type="button" className="danger link-btn" onClick={() => removeSchedule(index)}>Remove</button>
                            </div>
                            <SchedulePicker schedule={s} onChange={next => updateSchedule(index, next)} />
                        </div>
                    ))}
                <button type="button" onClick={addSchedule}>+ Add schedule</button>
            </fieldset>

            <fieldset>
                <legend>Devices</legend>
                {devices.length === 0
                    ? <p className="muted">No devices available — include a device first.</p>
                    : groups.map(group => {
                        const count = group.devices.filter(device => selected[device.nodeId]).length;
                        const open = openGroups[group.key] ?? false;

                        return (
                            <div key={group.key} className="device-group">
                                <button
                                    type="button"
                                    className="device-group-head"
                                    aria-expanded={open}
                                    onClick={() => setOpenGroups(current => ({ ...current, [group.key]: !open }))}
                                >
                                    <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true" />
                                    <span className="device-group-label">{group.label}</span>
                                    {count > 0 && <span className="device-group-count">{count}</span>}
                                </button>

                                {open && group.devices.map(device => (
                                    <DeviceRow
                                        key={device.nodeId}
                                        device={device}
                                        state={selected[device.nodeId]}
                                        onToggle={() => toggle(device)}
                                        onUpdate={update}
                                    />
                                ))}
                            </div>
                        );
                    })}
            </fieldset>

            {/* Sticky, so committing never means scrolling back past the device list */}
            <div className="form-actions">
                <button type="submit" className="primary" disabled={!canSave}>Save</button>
                <button type="button" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
}

interface DeviceRowProps {
    device: IDeviceInfo;
    state: SelectedState | undefined;
    onToggle: () => void;
    onUpdate: (nodeId: number, patch: Partial<SelectedState>) => void;
}

function DeviceRow({ device, state, onToggle, onUpdate }: DeviceRowProps) {
    const isDimmer = device.type === DeviceType.Dimmer;

    return (
        <div className="scene-row">
            <label className="check">
                <input type="checkbox" checked={Boolean(state)} onChange={onToggle} />
                <span>{device.name || `Node ${device.nodeId}`}</span>
            </label>

            {state && (
                <div className="scene-row-controls">
                    <select
                        value={state.action}
                        onChange={e => onUpdate(device.nodeId, { action: e.target.value as DeviceAction })}
                    >
                        <option value={DeviceAction.On}>On</option>
                        <option value={DeviceAction.Off}>Off</option>
                        {isDimmer && <option value={DeviceAction.Dim}>Dim</option>}
                    </select>

                    {state.action === DeviceAction.Dim && (
                        <>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                value={state.level}
                                onChange={e => onUpdate(device.nodeId, { level: Number(e.target.value) })}
                                aria-label={`Level for ${device.name || device.nodeId}`}
                            />
                            <span className="level">{state.level}%</span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
