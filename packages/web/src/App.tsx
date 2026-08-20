import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { IDeviceInfo, INetworkHealth, IRoom, IScene, ISceneStatus } from '@zwave-service/contracts';
import type { RunFn } from './types.ts';
import { api } from './api.ts';
import { usePressFeedback } from './press.ts';
import { Toast, useToast } from './Toast.tsx';
import { DashboardPanel } from './panels/DashboardPanel.tsx';
import { DevicesPanel } from './panels/DevicesPanel.tsx';
import { RoomsPanel } from './panels/RoomsPanel.tsx';
import { ScenesPanel } from './panels/ScenesPanel.tsx';
import { HealthPanel } from './panels/HealthPanel.tsx';

type Tab = 'dashboard' | 'devices' | 'rooms' | 'scenes' | 'health';

// Bottom navigation. The Dashboard is the implicit home — it is the first entry and
// the view the app opens on; Devices/Rooms/Scenes are destinations reached from the
// bar rather than tabs stacked above the content.
const TABS: { id: Tab; label: string; icon: ReactElement }[] = [
    { id: 'dashboard', label: 'Home', icon: <IconHome /> },
    { id: 'devices', label: 'Devices', icon: <IconDevices /> },
    { id: 'rooms', label: 'Rooms', icon: <IconRooms /> },
    { id: 'scenes', label: 'Scenes', icon: <IconScenes /> },
    { id: 'health', label: 'Health', icon: <IconHealth /> }
];

// Small line icons, drawn in currentColor so they follow the active/inactive color
function IconHome() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 11.2 12 4l8 7.2M6.5 10v9.5h11V10" />
        </svg>
    );
}

function IconDevices() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="4.5" y="3.5" width="15" height="17" rx="3" />
            <circle cx="12" cy="9" r="2.2" />
            <path d="M9 16.5h6" />
        </svg>
    );
}

function IconRooms() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" />
            <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6" />
            <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" />
            <rect x="13" y="13" width="7.5" height="7.5" rx="1.6" />
        </svg>
    );
}

// A trace with a beat in it — the mesh's vital signs
function IconHealth() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 12.5h4l2.5-6 3.5 12 2.5-6h5.5" />
        </svg>
    );
}

function IconScenes() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3.8l2.1 4.6 4.9.6-3.6 3.4.9 4.9L12 15l-4.3 2.3.9-4.9L5 9l4.9-.6z" />
        </svg>
    );
}

function toMessage(ex: unknown): string {
    return ex instanceof Error ? ex.message : String(ex);
}

export function App() {
    const [tab, setTab] = useState<Tab>('dashboard');
    const [devices, setDevices] = useState<IDeviceInfo[]>([]);
    const [rooms, setRooms] = useState<IRoom[]>([]);
    const [scenes, setScenes] = useState<IScene[]>([]);
    const [sceneStatus, setSceneStatus] = useState<ISceneStatus[]>([]);
    const [health, setHealth] = useState<INetworkHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [toast, { show, dismiss }] = useToast();

    // Subtle press highlighting for every button (see press.ts)
    usePressFeedback();

    const refreshDevices = useCallback(async (): Promise<void> => {
        try {
            setDevices(await api.listDevices());
        }
        catch (ex) {
            show('error', toMessage(ex));
        }
        finally {
            setLoading(false);
        }
    }, [show]);

    const refreshRooms = useCallback(async (): Promise<void> => {
        try {
            setRooms(await api.listRooms());
        }
        catch (ex) {
            show('error', toMessage(ex));
        }
    }, [show]);

    const refreshScenes = useCallback(async (): Promise<void> => {
        try {
            setScenes(await api.listScenes());
        }
        catch (ex) {
            show('error', toMessage(ex));
        }
    }, [show]);

    // Health is sampled service-side every 30s and the sweep pings a device every 60s,
    // so this poll keeps the chart's right edge and the swept dot moving. A failure here
    // is left silent: the panel shows its own placeholder, and a toast every poll while
    // the driver restarts would be noise.
    const refreshHealth = useCallback(async (): Promise<void> => {
        try {
            setHealth(await api.getNetworkHealth());
        }
        catch {
            // keep the last verdict on screen
        }
    }, []);

    const refreshSceneStatus = useCallback(async (): Promise<void> => {
        try {
            setSceneStatus(await api.listSceneStatus());
        }
        catch (ex) {
            show('error', toMessage(ex));
        }
    }, [show]);

    // Initial load, then poll device state and scene run-times so the UI stays live
    useEffect(() => {
        void refreshDevices();
        void refreshRooms();
        void refreshScenes();
        void refreshSceneStatus();
        void refreshHealth();

        const id = setInterval(() => {
            void refreshDevices();
            void refreshSceneStatus();
            void refreshHealth();
        }, 5000);
        return () => clearInterval(id);
    }, [refreshDevices, refreshRooms, refreshScenes, refreshSceneStatus, refreshHealth]);

    const run = useCallback<RunFn>(async (fn, successMessage) => {
        try {
            const result = await fn();

            const message = successMessage
                ?? (result && typeof result === 'object' && 'message' in result
                    ? String((result as { message: unknown }).message)
                    : undefined);
            if (message) {
                show('status', message);
            }

            return true;
        }
        catch (ex) {
            show('error', toMessage(ex));

            return false;
        }
    }, [show]);

    return (
        <div className="app">
            <h1 className="sr-only">Z-Wave Control</h1>

            {loading
                ? <p className="muted">Loading…</p>
                : tab === 'dashboard'
                    ? <DashboardPanel devices={devices} health={health} rooms={rooms} scenes={scenes} statuses={sceneStatus} />
                    : tab === 'devices'
                        ? <DevicesPanel devices={devices} run={run} refresh={refreshDevices} />
                        : tab === 'rooms'
                            ? <RoomsPanel rooms={rooms} devices={devices} run={run} refresh={refreshRooms} refreshDevices={refreshDevices} />
                            : tab === 'scenes'
                                ? <ScenesPanel scenes={scenes} statuses={sceneStatus} rooms={rooms} devices={devices} run={run} refresh={refreshScenes} refreshStatus={refreshSceneStatus} refreshDevices={refreshDevices} />
                                : <HealthPanel health={health} />}

            <nav className="bottom-nav">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        className={tab === t.id ? 'nav-item active' : 'nav-item'}
                        aria-current={tab === t.id ? 'page' : undefined}
                        onClick={() => setTab(t.id)}
                    >
                        <span className="nav-icon">{t.icon}</span>
                        <span className="nav-label">{t.label}</span>
                        {t.id === 'devices' && devices.length > 0 && <span className="nav-count">{devices.length}</span>}
                        {t.id === 'rooms' && rooms.length > 0 && <span className="nav-count">{rooms.length}</span>}
                        {t.id === 'scenes' && scenes.length > 0 && <span className="nav-count">{scenes.length}</span>}
                    </button>
                ))}
            </nav>

            <Toast toast={toast} onDismiss={dismiss} />
        </div>
    );
}
