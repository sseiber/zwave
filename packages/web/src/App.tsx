import { useCallback, useEffect, useState } from 'react';
import type { IDeviceInfo, IRoom, IScene } from '@zwave-service/contracts';
import type { RunFn } from './types.ts';
import { api } from './api.ts';
import { DevicesPanel } from './panels/DevicesPanel.tsx';
import { RoomsPanel } from './panels/RoomsPanel.tsx';
import { ScenesPanel } from './panels/ScenesPanel.tsx';

type Tab = 'devices' | 'rooms' | 'scenes';

const TABS: { id: Tab; label: string }[] = [
    { id: 'devices', label: 'Devices' },
    { id: 'rooms', label: 'Rooms' },
    { id: 'scenes', label: 'Scenes' }
];

function toMessage(ex: unknown): string {
    return ex instanceof Error ? ex.message : String(ex);
}

export function App() {
    const [tab, setTab] = useState<Tab>('devices');
    const [devices, setDevices] = useState<IDeviceInfo[]>([]);
    const [rooms, setRooms] = useState<IRoom[]>([]);
    const [scenes, setScenes] = useState<IScene[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);

    const refreshDevices = useCallback(async (): Promise<void> => {
        try {
            setDevices(await api.listDevices());
            setError(null);
        }
        catch (ex) {
            setError(toMessage(ex));
        }
        finally {
            setLoading(false);
        }
    }, []);

    const refreshRooms = useCallback(async (): Promise<void> => {
        try {
            setRooms(await api.listRooms());
        }
        catch (ex) {
            setError(toMessage(ex));
        }
    }, []);

    const refreshScenes = useCallback(async (): Promise<void> => {
        try {
            setScenes(await api.listScenes());
        }
        catch (ex) {
            setError(toMessage(ex));
        }
    }, []);

    // Initial load, then poll device state so the UI reflects the mesh
    useEffect(() => {
        void refreshDevices();
        void refreshRooms();
        void refreshScenes();

        const id = setInterval(() => void refreshDevices(), 5000);
        return () => clearInterval(id);
    }, [refreshDevices, refreshRooms, refreshScenes]);

    const run = useCallback<RunFn>(async (fn, successMessage) => {
        try {
            const result = await fn();
            setError(null);

            const message = successMessage
                ?? (result && typeof result === 'object' && 'message' in result
                    ? String((result as { message: unknown }).message)
                    : undefined);
            if (message) {
                setStatus(message);
            }

            return true;
        }
        catch (ex) {
            setError(toMessage(ex));

            return false;
        }
    }, []);

    return (
        <div className="app">
            <header>
                <h1>Z-Wave Control</h1>
                <button onClick={() => { void refreshDevices(); void refreshRooms(); void refreshScenes(); }}>Refresh</button>
            </header>

            <nav className="tabs">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        className={tab === t.id ? 'tab active' : 'tab'}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                        {t.id === 'rooms' && rooms.length > 0 && <span className="count">{rooms.length}</span>}
                        {t.id === 'scenes' && scenes.length > 0 && <span className="count">{scenes.length}</span>}
                        {t.id === 'devices' && devices.length > 0 && <span className="count">{devices.length}</span>}
                    </button>
                ))}
            </nav>

            {error && <div className="banner error" onClick={() => setError(null)}>{error}</div>}
            {status && !error && <div className="banner status" onClick={() => setStatus(null)}>{status}</div>}

            {loading
                ? <p className="muted">Loading…</p>
                : tab === 'devices'
                    ? <DevicesPanel devices={devices} run={run} refresh={refreshDevices} />
                    : tab === 'rooms'
                        ? <RoomsPanel rooms={rooms} devices={devices} run={run} refresh={refreshRooms} />
                        : <ScenesPanel scenes={scenes} rooms={rooms} devices={devices} run={run} refresh={refreshScenes} />}
        </div>
    );
}
