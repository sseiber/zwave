import { useState } from 'react';
import type { IDeviceInfo, IRoom, IScene, ISceneDevice, ISceneStatus, ISchedule } from '@zwave-service/contracts';
import { DeviceAction, DeviceType, SceneTrigger, ScheduleKind } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';
import { defaultSchedule, describeSchedule } from '../schedule.ts';
import { relativeTime, relativeUpcoming, absoluteTime } from '../format.ts';
import { SchedulePicker } from './SchedulePicker.tsx';

interface ScenesPanelProps {
    scenes: IScene[];
    statuses: ISceneStatus[];
    rooms: IRoom[];
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
    refreshStatus: () => Promise<void>;
}

type Editing = IScene | 'new' | null;

export function ScenesPanel({ scenes, statuses, rooms, devices, run, refresh, refreshStatus }: ScenesPanelProps) {
    const [editing, setEditing] = useState<Editing>(null);

    const statusById = new Map(statuses.map(s => [s.sceneId, s]));

    const activate = async (scene: IScene): Promise<void> => {
        await run(() => api.activateScene(scene.id));
        await refresh();
        await refreshStatus();
    };

    const remove = async (scene: IScene): Promise<void> => {
        if (!confirm(`Delete scene “${scene.name}”?`)) {
            return;
        }
        if (await run(() => api.deleteScene(scene.id))) {
            await refresh();
        }
    };

    const save = async (name: string, roomId: string | undefined, trigger: SceneTrigger, schedule: ISchedule | undefined, sceneDevices: ISceneDevice[]): Promise<void> => {
        const ok = editing === 'new'
            ? await run(() => api.createScene({ name, roomId, trigger, schedule, devices: sceneDevices }), `Scene “${name}” created`)
            : await run(() => api.updateScene((editing as IScene).id, { name, roomId, trigger, schedule, devices: sceneDevices }), `Scene “${name}” updated`);

        if (ok) {
            setEditing(null);
            await refresh();
        }
    };

    return (
        <section>
            <div className="panel-head">
                <h2>Scenes</h2>
                <button
                    className="primary"
                    onClick={() => setEditing('new')}
                    disabled={editing !== null || devices.length === 0}
                >
                    New scene
                </button>
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
                : (
                    <ul className="cards">
                        {scenes.map(scene => (
                            <li key={scene.id} className="card">
                                <div className="card-head">
                                    <span className="name">{scene.name}</span>
                                    <span className={`pill ${scene.trigger}`}>{scene.trigger}</span>
                                </div>
                                <div className="meta">
                                    {scene.roomId && <span>{roomName(rooms, scene.roomId)}</span>}
                                    <span>{scene.devices.length} device{scene.devices.length === 1 ? '' : 's'}</span>
                                    {scene.trigger === SceneTrigger.Scheduled && (
                                        <span className="sched">{describeSchedule(scene.schedule)}</span>
                                    )}
                                </div>
                                <SceneRunTimes scene={scene} status={statusById.get(scene.id)} />
                                <ul className="scene-actions">
                                    {scene.devices.map(d => (
                                        <li key={d.deviceId}>
                                            {deviceName(devices, d.deviceId)} → <strong>{describeAction(d)}</strong>
                                        </li>
                                    ))}
                                </ul>
                                <div className="controls">
                                    <button className="primary" onClick={() => void activate(scene)}>Activate</button>
                                    <span className="spacer" />
                                    <button onClick={() => setEditing(scene)}>Edit</button>
                                    <button className="danger" onClick={() => void remove(scene)}>Delete</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
        </section>
    );
}

function SceneRunTimes({ scene, status }: { scene: IScene; status: ISceneStatus | undefined }) {
    const showNext = scene.trigger === SceneTrigger.Scheduled;
    const hasLast = Boolean(status?.lastRun);

    // Scheduled scenes always show a "Next" (even if unplanned); manual scenes only
    // appear here once they've been run at least once.
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

function roomName(rooms: IRoom[], roomId: string): string {
    return rooms.find(r => r.id === roomId)?.name ?? 'Unknown room';
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
    onSave: (name: string, roomId: string | undefined, trigger: SceneTrigger, schedule: ISchedule | undefined, devices: ISceneDevice[]) => Promise<void>;
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
    const [trigger, setTrigger] = useState<SceneTrigger>(scene?.trigger ?? SceneTrigger.Manual);
    const [schedule, setSchedule] = useState<ISchedule>(scene?.schedule ?? defaultSchedule(ScheduleKind.Daily));
    const [selected, setSelected] = useState<Record<number, SelectedState>>(() => {
        const initial: Record<number, SelectedState> = {};
        scene?.devices.forEach(d => {
            initial[d.deviceId] = { action: d.action, level: d.level ?? 50 };
        });
        return initial;
    });

    // Every device on the controller, grouped by room — a scene is not scoped to a room
    const groups = groupDevicesByRoom(devices, rooms);

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

    const canSave = name.trim().length > 0 && Object.keys(selected).length > 0;

    const submit = (): void => {
        const sceneDevices: ISceneDevice[] = Object.entries(selected).map(([id, state]) => ({
            deviceId: Number(id),
            action: state.action,
            ...(state.action === DeviceAction.Dim ? { level: state.level } : {})
        }));

        void onSave(name.trim(), roomId || undefined, trigger, trigger === SceneTrigger.Scheduled ? schedule : undefined, sceneDevices);
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
                <span>Room <span className="muted">(optional label)</span></span>
                <select value={roomId} onChange={e => setRoomId(e.target.value)}>
                    <option value="">No room</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
            </label>

            <label>
                <span>Trigger</span>
                <select value={trigger} onChange={e => setTrigger(e.target.value as SceneTrigger)}>
                    <option value={SceneTrigger.Manual}>Manual — activate on demand</option>
                    <option value={SceneTrigger.Scheduled}>Scheduled — run automatically</option>
                </select>
            </label>

            {trigger === SceneTrigger.Scheduled && (
                <SchedulePicker schedule={schedule} onChange={setSchedule} />
            )}

            <fieldset>
                <legend>Devices and what they do</legend>
                {devices.length === 0
                    ? <p className="muted">No devices available — include a device first.</p>
                    : groups.map(group => (
                        <div key={group.key} className="device-group">
                            <h4 className="device-group-head">{group.label}</h4>
                            {group.devices.map(device => (
                                <DeviceRow
                                    key={device.nodeId}
                                    device={device}
                                    state={selected[device.nodeId]}
                                    onToggle={() => toggle(device)}
                                    onUpdate={update}
                                />
                            ))}
                        </div>
                    ))}
            </fieldset>

            <div className="controls">
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
                <span>{device.name || `Node ${device.nodeId}`} <span className="muted">{device.name ? `· node ${device.nodeId} ` : ''}· {device.type}</span></span>
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
