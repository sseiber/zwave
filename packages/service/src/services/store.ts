import {
    FastifyInstance,
    FastifyPluginAsync
} from 'fastify';
import fp from 'fastify-plugin';
import { resolve as pathResolve } from 'node:path';
import fse from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import {
    IRoom,
    ICreateRoomRequest,
    IUpdateRoomRequest,
    IScene,
    ICreateSceneRequest,
    IUpdateSceneRequest,
    ISceneRunResult
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { PluginName as ConfigPluginName } from '../plugins/config.js';

export const ServiceName = 'store';

const RoomsFileName = 'rooms.json';
const ScenesFileName = 'scenes.json';
const SceneRunsFileName = 'sceneRuns.json';

// Run records are written back to disk at most this often per store: a scene on a
// 1s interval would otherwise rewrite the file every tick. The in-memory map stays
// authoritative and the trailing write is flushed on shutdown, so at most this much
// last-run history is lost on an unclean stop.
const RunsThrottleMs = 30 * 1000;

// Persisted last-run record for a scene. Kept out of IScene so the stored scene stays
// a pure user-defined shape; nextRun is never persisted (it depends on "now").
export interface ISceneRunRecord {
    sceneId: string;
    lastRun: string;     // ISO date-time
    lastResult: ISceneRunResult;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IStorePluginOptions { }

const storePlugin: FastifyPluginAsync<IStorePluginOptions> = async (server: FastifyInstance, _options: IStorePluginOptions): Promise<void> => {
    server.log.info({ tags: [ServiceName] }, `Registering...`);

    try {
        const store = await RoomSceneStore.createStore(server);

        server.decorate(ServiceName, store);

        // Persist any throttled run record still pending when the service stops
        server.addHook('onClose', async () => {
            await store.flushSceneRuns();
        });
    }
    catch (ex) {
        server.log.error({ tags: [ServiceName] }, `registering failed: ${exMessage(ex)}`);

        throw ex;
    }
};

class RoomSceneStore {
    public static async createStore(server: FastifyInstance): Promise<RoomSceneStore> {
        const storagePath = server.config.env.zwaveStorage;

        const rooms = await RoomSceneStore.readCollection<IRoom>(pathResolve(storagePath, RoomsFileName));
        const scenes = await RoomSceneStore.readCollection<IScene>(pathResolve(storagePath, ScenesFileName));
        const runs = await RoomSceneStore.readCollection<ISceneRunRecord>(pathResolve(storagePath, SceneRunsFileName));

        server.log.info({ tags: [ServiceName] }, `Loaded ${rooms.length} room(s) and ${scenes.length} scene(s) from ${storagePath}`);

        return new RoomSceneStore(server, storagePath, rooms, scenes, runs);
    }

    private static async readCollection<T>(filePath: string): Promise<T[]> {
        try {
            if (!(await fse.pathExists(filePath))) {
                return [];
            }

            const data = await fse.readJson(filePath) as T[];

            return Array.isArray(data) ? data : [];
        }
        catch {
            return [];
        }
    }

    private server: FastifyInstance;
    private storagePath: string;
    private rooms: IRoom[];
    private scenes: IScene[];
    private runs: Map<string, ISceneRunRecord>;
    private runsFlushTimer: NodeJS.Timeout | undefined;
    private lastRunsFlush: number;

    constructor(server: FastifyInstance, storagePath: string, rooms: IRoom[], scenes: IScene[], runs: ISceneRunRecord[]) {
        this.server = server;
        this.storagePath = storagePath;
        this.rooms = rooms;
        this.scenes = scenes;
        this.runs = new Map(runs.map(run => [run.sceneId, run]));
        this.lastRunsFlush = 0;
    }

    //
    // Rooms
    //
    public listRooms(): IRoom[] {
        return this.rooms;
    }

    public getRoom(roomId: string): IRoom | undefined {
        return this.rooms.find(room => room.id === roomId);
    }

    public async createRoom(request: ICreateRoomRequest): Promise<IRoom> {
        const room: IRoom = {
            id: uuidv4(),
            name: request.name,
            deviceIds: request.deviceIds ?? []
        };

        this.rooms.push(room);

        await this.persistRooms();

        return room;
    }

    public async updateRoom(roomId: string, request: IUpdateRoomRequest): Promise<IRoom | undefined> {
        const room = this.getRoom(roomId);
        if (!room) {
            return undefined;
        }

        if (request.name !== undefined) {
            room.name = request.name;
        }

        if (request.deviceIds !== undefined) {
            room.deviceIds = request.deviceIds;
        }

        await this.persistRooms();

        return room;
    }

    public async deleteRoom(roomId: string): Promise<boolean> {
        const index = this.rooms.findIndex(room => room.id === roomId);
        if (index < 0) {
            return false;
        }

        this.rooms.splice(index, 1);

        await this.persistRooms();

        return true;
    }

    //
    // Scenes
    //
    public listScenes(): IScene[] {
        return this.scenes;
    }

    public getScene(sceneId: string): IScene | undefined {
        return this.scenes.find(scene => scene.id === sceneId);
    }

    public async createScene(request: ICreateSceneRequest): Promise<IScene> {
        const scene: IScene = {
            id: uuidv4(),
            name: request.name,
            roomId: request.roomId,
            trigger: request.trigger,
            schedule: request.schedule,
            devices: request.devices ?? []
        };

        this.scenes.push(scene);

        await this.persistScenes();

        return scene;
    }

    public async updateScene(sceneId: string, request: IUpdateSceneRequest): Promise<IScene | undefined> {
        const scene = this.getScene(sceneId);
        if (!scene) {
            return undefined;
        }

        if (request.name !== undefined) {
            scene.name = request.name;
        }

        if (request.roomId !== undefined) {
            scene.roomId = request.roomId;
        }

        if (request.trigger !== undefined) {
            scene.trigger = request.trigger;
        }

        if (request.schedule !== undefined) {
            scene.schedule = request.schedule;
        }

        if (request.devices !== undefined) {
            scene.devices = request.devices;
        }

        await this.persistScenes();

        return scene;
    }

    public async deleteScene(sceneId: string): Promise<boolean> {
        const index = this.scenes.findIndex(scene => scene.id === sceneId);
        if (index < 0) {
            return false;
        }

        this.scenes.splice(index, 1);

        // Drop the orphaned run record so it doesn't linger in sceneRuns.json
        if (this.runs.delete(sceneId)) {
            this.scheduleRunsFlush();
        }

        await this.persistScenes();

        return true;
    }

    //
    // Scene run records (last activation + result), persisted with a throttled write
    //
    public getSceneRun(sceneId: string): ISceneRunRecord | undefined {
        return this.runs.get(sceneId);
    }

    public listSceneRuns(): ISceneRunRecord[] {
        return [...this.runs.values()];
    }

    // Records that a scene activated (manual or scheduled). The in-memory value is
    // authoritative and updated synchronously; the disk write is throttled.
    public recordSceneRun(sceneId: string, whenMs: number, result: ISceneRunResult): void {
        this.runs.set(sceneId, {
            sceneId,
            lastRun: new Date(whenMs).toISOString(),
            lastResult: result
        });

        this.scheduleRunsFlush();
    }

    // Flush any pending run-record write immediately (called on shutdown)
    public async flushSceneRuns(): Promise<void> {
        if (this.runsFlushTimer) {
            clearTimeout(this.runsFlushTimer);
            this.runsFlushTimer = undefined;

            await this.flushRuns();
        }
    }

    private scheduleRunsFlush(): void {
        // A flush is already pending; the current in-memory state will be captured by it
        if (this.runsFlushTimer) {
            return;
        }

        const delay = Math.max(0, RunsThrottleMs - (Date.now() - this.lastRunsFlush));

        this.runsFlushTimer = setTimeout(() => {
            this.runsFlushTimer = undefined;

            void this.flushRuns();
        }, delay);

        // Don't keep the event loop alive just for a run-record flush
        this.runsFlushTimer.unref?.();
    }

    private async flushRuns(): Promise<void> {
        this.lastRunsFlush = Date.now();

        try {
            await this.writeCollection(SceneRunsFileName, [...this.runs.values()]);
        }
        catch {
            // writeCollection already logged; swallow so a throttled flush never crashes the tick
        }
    }

    //
    // Persistence (atomic write via temp file + rename)
    //
    private async persistRooms(): Promise<void> {
        await this.writeCollection(RoomsFileName, this.rooms);
    }

    private async persistScenes(): Promise<void> {
        await this.writeCollection(ScenesFileName, this.scenes);
    }

    private async writeCollection(fileName: string, data: unknown): Promise<void> {
        const filePath = pathResolve(this.storagePath, fileName);
        const tempPath = `${filePath}.tmp`;

        try {
            await fse.writeJson(tempPath, data, { spaces: 4 });
            await fse.move(tempPath, filePath, { overwrite: true });
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `Failed to persist ${fileName}: ${exMessage(ex)}`);

            throw ex;
        }
    }
}

declare module 'fastify' {
    interface FastifyInstance {
        [ServiceName]: RoomSceneStore;
    }
}

export default fp(storePlugin, {
    fastify: '5.x',
    name: ServiceName,
    dependencies: [
        ConfigPluginName
    ]
});
