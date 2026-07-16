import { useState } from 'react';
import type { IDeviceInfo, IRoom } from '@zwave-service/contracts';
import { DeviceAction } from '@zwave-service/contracts';
import type { RunFn } from '../types.ts';
import { api } from '../api.ts';

interface RoomsPanelProps {
    rooms: IRoom[];
    devices: IDeviceInfo[];
    run: RunFn;
    refresh: () => Promise<void>;
}

type Editing = IRoom | 'new' | null;

export function RoomsPanel({ rooms, devices, run, refresh }: RoomsPanelProps) {
    const [editing, setEditing] = useState<Editing>(null);

    const remove = async (room: IRoom): Promise<void> => {
        if (!confirm(`Delete room “${room.name}”? Devices are not affected.`)) {
            return;
        }
        if (await run(() => api.deleteRoom(room.id))) {
            await refresh();
        }
    };

    const control = async (room: IRoom, action: DeviceAction): Promise<void> => {
        await run(() => api.controlRoom(room.id, { action }));
    };

    const save = async (name: string, deviceIds: number[]): Promise<void> => {
        const ok = editing === 'new'
            ? await run(() => api.createRoom({ name, deviceIds }), `Room “${name}” created`)
            : await run(() => api.updateRoom((editing as IRoom).id, { name, deviceIds }), `Room “${name}” updated`);

        if (ok) {
            setEditing(null);
            await refresh();
        }
    };

    return (
        <section>
            <div className="panel-head">
                <h2>Rooms</h2>
                <button className="primary" onClick={() => setEditing('new')} disabled={editing !== null}>New room</button>
            </div>

            {editing && (
                <RoomForm
                    room={editing === 'new' ? undefined : editing}
                    devices={devices}
                    onCancel={() => setEditing(null)}
                    onSave={save}
                />
            )}

            {rooms.length === 0 && !editing
                ? <p className="muted">No rooms yet. Create one to group devices together.</p>
                : (
                    <ul className="cards">
                        {rooms.map(room => (
                            <li key={room.id} className="card">
                                <div className="card-head">
                                    <span className="name">{room.name}</span>
                                    <span className="pill">{room.deviceIds.length} device{room.deviceIds.length === 1 ? '' : 's'}</span>
                                </div>
                                <div className="meta">
                                    {room.deviceIds.length === 0
                                        ? <span>No devices assigned</span>
                                        : room.deviceIds.map(id => (
                                            <span key={id}>{deviceName(devices, id)}</span>
                                        ))}
                                </div>
                                <div className="controls">
                                    <button onClick={() => void control(room, DeviceAction.On)}>All on</button>
                                    <button onClick={() => void control(room, DeviceAction.Off)}>All off</button>
                                    <span className="spacer" />
                                    <button onClick={() => setEditing(room)}>Edit</button>
                                    <button className="danger" onClick={() => void remove(room)}>Delete</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
        </section>
    );
}

function deviceName(devices: IDeviceInfo[], nodeId: number): string {
    const device = devices.find(d => d.nodeId === nodeId);
    return device ? (device.name || `Node ${device.nodeId}`) : `Node ${nodeId} (missing)`;
}

interface RoomFormProps {
    room?: IRoom;
    devices: IDeviceInfo[];
    onCancel: () => void;
    onSave: (name: string, deviceIds: number[]) => Promise<void>;
}

function RoomForm({ room, devices, onCancel, onSave }: RoomFormProps) {
    const [name, setName] = useState(room?.name ?? '');
    const [deviceIds, setDeviceIds] = useState<number[]>(room?.deviceIds ?? []);

    const toggle = (nodeId: number): void => {
        setDeviceIds(current => current.includes(nodeId)
            ? current.filter(id => id !== nodeId)
            : [...current, nodeId]);
    };

    const canSave = name.trim().length > 0;

    return (
        <form
            className="card form"
            onSubmit={e => {
                e.preventDefault();
                if (canSave) {
                    void onSave(name.trim(), deviceIds);
                }
            }}
        >
            <h3>{room ? `Edit “${room.name}”` : 'New room'}</h3>

            <label>
                <span>Name</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Kitchen" autoFocus />
            </label>

            <fieldset>
                <legend>Devices in this room</legend>
                {devices.length === 0
                    ? <p className="muted">No devices available — include a device first.</p>
                    : devices.map(device => (
                        <label key={device.nodeId} className="check">
                            <input
                                type="checkbox"
                                checked={deviceIds.includes(device.nodeId)}
                                onChange={() => toggle(device.nodeId)}
                            />
                            <span>{device.name || `Node ${device.nodeId}`} <span className="muted">#{device.nodeId} · {device.type}</span></span>
                        </label>
                    ))}
            </fieldset>

            <div className="controls">
                <button type="submit" className="primary" disabled={!canSave}>Save</button>
                <button type="button" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
}
