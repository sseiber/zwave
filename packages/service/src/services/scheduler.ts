import {
    FastifyInstance,
    FastifyPluginCallback,
    HookHandlerDoneFunction
} from 'fastify';
import fp from 'fastify-plugin';
import {
    IScene,
    ISceneStatus,
    SceneTrigger
} from '../models/index.js';
import { exMessage, forget } from '../utils/index.js';
import { computeNextRun, getGeoLocation, IGeoLocation } from './schedule.js';
import { ServiceName as StoreServiceName } from './store.js';
import { ServiceName as ZWaveServiceName } from './zwave.js';

export const ServiceName = 'scheduler';

// Scheduled scenes are evaluated on a tick rather than per-scene timers: the scene
// list is small and held in memory, so this stays cheap and picks up create/update/
// delete without any change hooks. A 1s tick also supports second-level intervals.
const TickIntervalMs = 1000;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ISchedulerPluginOptions { }

const schedulerPlugin: FastifyPluginCallback<ISchedulerPluginOptions> = (server: FastifyInstance, _options: ISchedulerPluginOptions, done: HookHandlerDoneFunction): void => {
    server.log.info({ tags: [ServiceName] }, `Registering...`);

    try {
        const scheduler = new SceneScheduler(server);

        scheduler.start();

        server.decorate(ServiceName, scheduler);

        server.addHook('onClose', (_instance, closeDone) => {
            scheduler.stop();

            closeDone();
        });
    }
    catch (ex) {
        server.log.error({ tags: [ServiceName] }, `registering failed: ${exMessage(ex)}`);

        return done(ex as Error);
    }

    return done();
};

interface IScheduleState {
    // JSON of the scene's schedule, so an edited schedule is re-planned
    signature: string;
    // Epoch ms of the next run, or undefined when the scene will never fire again
    nextRun?: number;
}

class SceneScheduler {
    private server: FastifyInstance;
    private geo: IGeoLocation | undefined;
    private timer: NodeJS.Timeout | undefined;
    private state: Map<string, IScheduleState>;

    constructor(server: FastifyInstance) {
        this.server = server;
        this.geo = getGeoLocation();
        this.state = new Map<string, IScheduleState>();
    }

    public start(): void {
        this.server.log.info({ tags: [ServiceName] }, this.geo
            ? `Scheduler started (lat ${this.geo.latitude}, lon ${this.geo.longitude}; timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone})`
            : `Scheduler started (no zwaveLatitude/zwaveLongitude configured - sunrise/sunset schedules are unavailable; timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

        this.timer = setInterval(() => this.tick(), TickIntervalMs);
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    // Next run times, for diagnostics
    public getPlan(): { sceneId: string; nextRun?: string }[] {
        return [...this.state.entries()].map(([sceneId, entry]) => ({
            sceneId,
            nextRun: entry.nextRun ? new Date(entry.nextRun).toISOString() : undefined
        }));
    }

    // Per-scene runtime status for the UI: planned nextRun (scheduled scenes only,
    // from the in-memory plan) merged with the persisted lastRun/lastResult. Returns
    // an entry for every scene so a manual scene still surfaces its last activation.
    public getSceneStatus(): ISceneStatus[] {
        return this.server.store.listScenes().map((scene) => {
            const nextRun = this.state.get(scene.id)?.nextRun;
            const run = this.server.store.getSceneRun(scene.id);

            return {
                sceneId: scene.id,
                nextRun: nextRun ? new Date(nextRun).toISOString() : undefined,
                lastRun: run?.lastRun,
                lastResult: run?.lastResult
            };
        });
    }

    private tick(): void {
        const now = Date.now();

        const scenes = this.server.store.listScenes()
            .filter(scene => scene.trigger === SceneTrigger.Scheduled && scene.schedule);

        // Forget scenes that were deleted or switched back to manual
        const activeIds = new Set(scenes.map(scene => scene.id));
        for (const sceneId of [...this.state.keys()]) {
            if (!activeIds.has(sceneId)) {
                this.state.delete(sceneId);
            }
        }

        for (const scene of scenes) {
            const signature = JSON.stringify(scene.schedule);
            const entry = this.state.get(scene.id);

            // New or edited schedule: plan it, but never fire on the planning tick
            if (entry?.signature !== signature) {
                this.plan(scene, signature, new Date(now));

                continue;
            }

            if (entry.nextRun !== undefined && entry.nextRun <= now) {
                forget(async () => this.activate(scene));

                // Plan from the fire time. computeNextRun always returns a time strictly
                // after `from`, so this cannot re-fire on the same tick, and planning
                // from `now` (rather than the missed target) avoids catch-up bursts if
                // the service was paused.
                this.plan(scene, signature, new Date(now));
            }
        }
    }

    private plan(scene: IScene, signature: string, from: Date): void {
        const nextRun = scene.schedule ? computeNextRun(scene.schedule, from, this.geo) : undefined;

        this.state.set(scene.id, { signature, nextRun: nextRun?.getTime() });

        if (nextRun) {
            this.server.log.info({ tags: [ServiceName] }, `Scene '${scene.name}' next run at ${nextRun.toISOString()}`);
        }
        else {
            this.server.log.warn({ tags: [ServiceName] }, `Scene '${scene.name}' has no future run (unusable schedule, past one-time date, or sunrise/sunset without a configured location)`);
        }
    }

    private async activate(scene: IScene): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `Activating scheduled scene '${scene.name}'`);

        const when = Date.now();

        try {
            const response = await this.server.zwaveService.applyScene(scene.devices);

            if (!response.succeeded) {
                this.server.log.warn({ tags: [ServiceName] }, `Scheduled scene '${scene.name}': ${response.message}`);
            }

            this.server.store.recordSceneRun(scene.id, when, { succeeded: response.succeeded, message: response.message });
        }
        catch (ex) {
            const message = exMessage(ex);

            this.server.log.error({ tags: [ServiceName] }, `Scheduled scene '${scene.name}' failed: ${message}`);

            this.server.store.recordSceneRun(scene.id, when, { succeeded: false, message });
        }
    }
}

declare module 'fastify' {
    interface FastifyInstance {
        [ServiceName]: SceneScheduler;
    }
}

export default fp(schedulerPlugin, {
    fastify: '5.x',
    name: ServiceName,
    dependencies: [
        StoreServiceName,
        ZWaveServiceName
    ]
});
