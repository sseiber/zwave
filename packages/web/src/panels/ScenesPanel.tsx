import { useState } from 'react';
import type { IDeviceInfo, IRoom, IScene, ISceneDevice, ISchedule } from '@zwave-service/contracts';
import { DeviceAction, DeviceType, SceneTrigger, ScheduleKind } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';
import { defaultSchedule, describeSchedule } from '../schedule.ts';
import { SchedulePicker } from './SchedulePicker.tsx';

interface ScenesPanelProps {
    scenes: IScene[];
    rooms: IRoom[];
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
}

type Editing = IScene | 'new' | null;

export function ScenesPanel({ scenes, rooms, devices, run, refresh }: ScenesPanelProps) {
    const [editing, setEditing] = useState<Editing>(null);

    const activate = async (scene: IScene): Promise<void> => {
        await run(() => api.activateScene(scene.id));
        await refresh();
    };

    const remove = async (scene: IScene): Promise<void> => {
        if (!confirm(`Delete scene “${scene.name}”?`)) {
            return;
        }
        if (await run(() => api.deleteScene(scene.id))) {
            await refresh();
        }
    };

    const save = async (name: string, roomId: string, trigger: SceneTrigger, schedule: ISchedule | undefined, sceneDevices: ISceneDevice[]): Promise<void> => {
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
                    disabled={editing !== null || rooms.length === 0}
                >
                    New scene
                </button>
            </div>

            {rooms.length === 0 && (
                <p className="muted">A scene belongs to a room — create a room first, then come back.</p>
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

            {scenes.length === 0 && !editing && rooms.length > 0
                ? <p className="muted">No scenes yet. Create one to set several devices at once.</p>
                : (
                    <ul className="cards">
                        {scenes.map(scene => (
                            <li key={scene.id} className="card">
                                <div className="card-head">
                                    <span className="name">{scene.name}</span>
                                    <span className={`pill ${scene.trigger}`}>{scene.trigger}</span>
                                </div>
                                <div className="meta">
                                    <span>{roomName(rooms, scene.roomId)}</span>
                                    <span>{scene.devices.length} device{scene.devices.length === 1 ? '' : 's'}</span>
                                    {scene.trigger === SceneTrigger.Scheduled && (
                                        <span className="sched">{describeSchedule(scene.schedule)}</span>
                                    )}
                                </div>
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
    onSave: (name: string, roomId: string, trigger: SceneTrigger, schedule: ISchedule | undefined, devices: ISceneDevice[]) => Promise<void>;
}

interface SelectedState {
    action: DeviceAction;
    level: number;
}

function SceneForm({ scene, rooms, devices, onCancel, onSave }: SceneFormProps) {
    const [name, setName] = useState(scene?.name ?? '');
    const [roomId, setRoomId] = useState(scene?.roomId ?? rooms[0]?.id ?? '');
    const [trigger, setTrigger] = useState<SceneTrigger>(scene?.trigger ?? SceneTrigger.Manual);
    const [schedule, setSchedule] = useState<ISchedule>(scene?.schedule ?? defaultSchedule(ScheduleKind.Daily));
    const [selected, setSelected] = useState<Record<number, SelectedState>>(() => {
        const initial: Record<number, SelectedState> = {};
        scene?.devices.forEach(d => {
            initial[d.deviceId] = { action: d.action, level: d.level ?? 50 };
        });
        return initial;
    });

    // Devices offered are the ones assigned to the selected room
    const room = rooms.find(r => r.id === roomId);
    const roomDevices = (room?.deviceIds ?? [])
        .map(id => devices.find(d => d.nodeId === id))
        .filter((d): d is IDeviceInfo => d !== undefined);

    const changeRoom = (nextRoomId: string): void => {
        setRoomId(nextRoomId);
        setSelected({});
    };

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

    const canSave = name.trim().length > 0 && roomId !== '' && Object.keys(selected).length > 0;

    const submit = (): void => {
        const sceneDevices: ISceneDevice[] = Object.entries(selected).map(([id, state]) => ({
            deviceId: Number(id),
            action: state.action,
            ...(state.action === DeviceAction.Dim ? { level: state.level } : {})
        }));

        void onSave(name.trim(), roomId, trigger, trigger === SceneTrigger.Scheduled ? schedule : undefined, sceneDevices);
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
                <span>Room</span>
                <select value={roomId} onChange={e => changeRoom(e.target.value)}>
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
                {roomDevices.length === 0
                    ? <p className="muted">This room has no devices. Add devices to the room first.</p>
                    : roomDevices.map(device => {
                        const state = selected[device.nodeId];
                        const isDimmer = device.type === DeviceType.Dimmer;

                        return (
                            <div key={device.nodeId} className="scene-row">
                                <label className="check">
                                    <input type="checkbox" checked={Boolean(state)} onChange={() => toggle(device)} />
                                    <span>{device.name || `Node ${device.nodeId}`} <span className="muted">#{device.nodeId} · {device.type}</span></span>
                                </label>

                                {state && (
                                    <div className="scene-row-controls">
                                        <select
                                            value={state.action}
                                            onChange={e => update(device.nodeId, { action: e.target.value as DeviceAction })}
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
                                                    onChange={e => update(device.nodeId, { level: Number(e.target.value) })}
                                                    aria-label={`Level for ${device.name || device.nodeId}`}
                                                />
                                                <span className="level">{state.level}%</span>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
            </fieldset>

            <div className="controls">
                <button type="submit" className="primary" disabled={!canSave}>Save</button>
                <button type="button" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
}
