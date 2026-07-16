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
    IUpdateSceneRequest
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { PluginName as ConfigPluginName } from '../plugins/config.js';

export const ServiceName = 'store';

const RoomsFileName = 'rooms.json';
const ScenesFileName = 'scenes.json';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IStorePluginOptions { }

const storePlugin: FastifyPluginAsync<IStorePluginOptions> = async (server: FastifyInstance, _options: IStorePluginOptions): Promise<void> => {
    server.log.info({ tags: [ServiceName] }, `Registering...`);

    try {
        const store = await RoomSceneStore.createStore(server);

        server.decorate(ServiceName, store);
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

        server.log.info({ tags: [ServiceName] }, `Loaded ${rooms.length} room(s) and ${scenes.length} scene(s) from ${storagePath}`);

        return new RoomSceneStore(server, storagePath, rooms, scenes);
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

    constructor(server: FastifyInstance, storagePath: string, rooms: IRoom[], scenes: IScene[]) {
        this.server = server;
        this.storagePath = storagePath;
        this.rooms = rooms;
        this.scenes = scenes;
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

        await this.persistScenes();

        return true;
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
