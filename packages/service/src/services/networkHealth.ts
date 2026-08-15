import {
    FastifyInstance,
    FastifyPluginCallback,
    HookHandlerDoneFunction
} from 'fastify';
import fp from 'fastify-plugin';
import {
    DeviceStatus,
    HealthState,
    IHealthFactor,
    IHealthSample,
    IHealthSweep,
    INetworkHealth,
    INodeHealth,
    NodeHealthState
} from '../models/index.js';
import { exMessage, forget } from '../utils/index.js';
import { INetworkTelemetry, INodeTelemetry } from './zwaveController.js';
import { ServiceName as ZWaveServiceName } from './zwave.js';

export const ServiceName = 'networkHealth';

//
// Network health.
//
// The raw driver statistics (controller traffic, per-node reliability, RF noise) are
// only useful to someone who already knows Z-Wave. This service samples them on a tick
// and folds them into one 0-100 score with a plain-language explanation of whatever is
// holding it down, keeping a short rolling history so the UI can show movement.
//

// How often telemetry is sampled. Traffic and error rates are deltas across this
// interval, so it also sets how quickly a problem shows up.
const SampleIntervalMs = 30 * 1000;

// ~2 hours of history at the sampling interval above — enough for the chart to show a
// shape without the payload growing large (each point is five small numbers).
const HistorySize = 240;

// The sweep pings one device at a time on rotation: a couple of dozen devices are all
// measured within half an hour, at one ping a minute. That is a negligible amount of
// traffic, and it is what keeps the readings (and the view) moving.
const SweepIntervalMs = 60 * 1000;

// Thresholds behind the verdict. Chosen to be quiet when things are fine: a mesh in
// good shape should sit at 100 and stay there.
const Thresholds = {
    // Share of controller messages that failed
    errorRateFair: 0.02,
    errorRatePoor: 0.08,
    // Share of commands to one device that were dropped or timed out
    nodeDropFair: 0.05,
    nodeDropPoor: 0.2,
    // Round-trip time to one device, ms
    rttFair: 500,
    rttPoor: 1500,
    // Signal, dBm
    rssiFair: -80,
    rssiPoor: -88,
    // How far the current noise floor may sit above its own average, dB
    noiseSpike: 10,
    // An absolute noise floor above this is loud regardless of the average, dBm
    noiseLoud: -70,
    // A mains-powered device unheard from for this long has probably fallen off
    staleHours: 24
};

// Score bands
const GoodScore = 85;
const FairScore = 60;

interface Sample {
    at: number;
    telemetry: INetworkTelemetry;
    point: IHealthSample;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface INetworkHealthPluginOptions { }

const networkHealthPlugin: FastifyPluginCallback<INetworkHealthPluginOptions> = (server: FastifyInstance, _options: INetworkHealthPluginOptions, done: HookHandlerDoneFunction): void => {
    server.log.info({ tags: [ServiceName] }, `Registering...`);

    try {
        const health = new NetworkHealth(server);

        health.start();

        server.decorate(ServiceName, health);

        server.addHook('onClose', (_instance, closeDone) => {
            health.stop();

            closeDone();
        });
    }
    catch (ex) {
        server.log.error({ tags: [ServiceName] }, `registering failed: ${exMessage(ex)}`);

        return done(ex as Error);
    }

    return done();
};

//
// Scoring. Pure functions over telemetry so the verdict can be reasoned about (and
// tested) without a live driver.
//

// Commands to a device that did not get through, as a share of everything sent to it
export function nodeDropRate(node: INodeTelemetry): number | undefined {
    const attempted = node.commandsTX + node.commandsDroppedTX;
    if (attempted === 0) {
        return undefined;
    }

    return (node.commandsDroppedTX + node.timeoutResponse) / attempted;
}

// Share of controller messages in an interval that failed in some way
export function trafficErrorRate(previous: INetworkTelemetry | undefined, current: INetworkTelemetry): { messages: number; errors: number; errorRate: number } {
    const delta = (pick: (t: INetworkTelemetry) => number): number => {
        const now = pick(current);
        const before = previous ? pick(previous) : 0;

        // A driver restart resets the counters; treat a decrease as a fresh start
        return Math.max(0, now - before);
    };

    const messages = delta(t => t.controller.messagesTX) + delta(t => t.controller.messagesRX);
    const errors = delta(t => t.controller.messagesDroppedTX)
        + delta(t => t.controller.messagesDroppedRX)
        + delta(t => t.controller.NAK)
        + delta(t => t.controller.CAN)
        + delta(t => t.controller.timeoutACK)
        + delta(t => t.controller.timeoutResponse)
        + delta(t => t.controller.timeoutCallback);

    return {
        messages,
        errors,
        errorRate: messages + errors > 0 ? errors / (messages + errors) : 0
    };
}

// Per-device verdict, folding reliability, latency, signal and silence together. A
// device is judged on the worst of these, since any one of them ruins it in practice.
export function nodeHealthState(node: INodeTelemetry, now: number): NodeHealthState {
    if (node.status === DeviceStatus.Dead) {
        return NodeHealthState.Offline;
    }

    const drop = nodeDropRate(node);
    const measured = drop !== undefined || node.rtt !== undefined || node.rssi !== undefined;

    if (!measured) {
        return NodeHealthState.Unknown;
    }

    if ((drop !== undefined && drop >= Thresholds.nodeDropPoor)
        || (node.rtt !== undefined && node.rtt >= Thresholds.rttPoor)
        || (node.rssi !== undefined && node.rssi <= Thresholds.rssiPoor)
        || isStale(node, now)) {
        return NodeHealthState.Poor;
    }

    if ((drop !== undefined && drop >= Thresholds.nodeDropFair)
        || (node.rtt !== undefined && node.rtt >= Thresholds.rttFair)
        || (node.rssi !== undefined && node.rssi <= Thresholds.rssiFair)) {
        return NodeHealthState.Fair;
    }

    return NodeHealthState.Good;
}

// Sleeping (battery) devices are silent by design, so silence only counts against a
// mains-powered device that should always be reachable.
function isStale(node: INodeTelemetry, now: number): boolean {
    if (node.canSleep || !node.lastSeen) {
        return false;
    }

    return now - new Date(node.lastSeen).getTime() > Thresholds.staleHours * 60 * 60 * 1000;
}

// Mean round-trip time across devices that have one, or undefined if none do
export function averageResponseMs(telemetry: INetworkTelemetry): number | undefined {
    const times = telemetry.nodes.map(node => node.rtt).filter((rtt): rtt is number => typeof rtt === 'number');

    if (times.length === 0) {
        return undefined;
    }

    return Math.round(times.reduce((total, rtt) => total + rtt, 0) / times.length);
}

// Epoch ms a device was last heard from; never-measured devices sort first
function seenAt(node: INodeTelemetry): number {
    return node.lastSeen ? new Date(node.lastSeen).getTime() : 0;
}

function round(value: number, places = 1): number {
    const factor = 10 ** places;

    return Math.round(value * factor) / factor;
}

function percent(value: number): string {
    return `${round(value * 100)}%`;
}

// Fold everything into a score, the factors that reduced it, and a sentence a person
// can act on. Penalties are capped per category so one bad device cannot alone declare
// the whole network broken.
export type HealthVerdict = Omit<INetworkHealth, 'samples' | 'sweep'>;

export function computeHealth(previous: INetworkTelemetry | undefined, current: INetworkTelemetry, intervalMs: number, now: number): HealthVerdict {
    const factors: IHealthFactor[] = [];
    const traffic = trafficErrorRate(previous, current);

    const nodes: INodeHealth[] = current.nodes.map((node) => {
        const drop = nodeDropRate(node);

        return {
            nodeId: node.nodeId,
            name: node.name,
            state: nodeHealthState(node, now),
            ...(drop !== undefined ? { dropRate: round(drop, 3) } : {}),
            ...(node.rtt !== undefined ? { rtt: Math.round(node.rtt) } : {}),
            ...(node.rssi !== undefined ? { rssi: Math.round(node.rssi) } : {}),
            ...(node.hops !== undefined ? { hops: node.hops } : {}),
            ...(node.dataRate !== undefined ? { dataRate: node.dataRate } : {}),
            ...(node.lastSeen ? { lastSeen: node.lastSeen } : {})
        };
    });

    const offline = nodes.filter(n => n.state === NodeHealthState.Offline);
    const unmeasured = nodes.filter(n => n.state === NodeHealthState.Unknown);
    const poor = nodes.filter(n => n.state === NodeHealthState.Poor);
    const fair = nodes.filter(n => n.state === NodeHealthState.Fair);

    // Offline devices — the most consequential thing that can be wrong
    if (offline.length > 0) {
        factors.push({
            label: offline.length === 1
                ? `${offline[0].name} is offline`
                : `${offline.length} devices are offline`,
            detail: offline.map(n => n.name).slice(0, 4).join(', '),
            impact: Math.min(50, 25 * offline.length),
            ...(offline.length === 1 ? { nodeId: offline[0].nodeId } : {})
        });
    }

    // Devices that answer unreliably or slowly
    for (const node of poor.slice(0, 3)) {
        const source = current.nodes.find(n => n.nodeId === node.nodeId);
        if (!source) {
            continue;
        }

        factors.push({
            label: `${node.name} is struggling`,
            detail: describeNodeProblem(node, source, now),
            impact: 10,
            nodeId: node.nodeId
        });
    }

    if (fair.length > 0) {
        factors.push({
            label: fair.length === 1
                ? `${fair[0].name} is marginal`
                : `${fair.length} devices are marginal`,
            detail: fair.map(n => n.name).slice(0, 4).join(', '),
            impact: Math.min(12, 4 * fair.length),
            ...(fair.length === 1 ? { nodeId: fair[0].nodeId } : {})
        });
    }

    // Controller traffic errors — retries, collisions and timeouts on the stick itself
    if (traffic.errorRate >= Thresholds.errorRateFair) {
        const poorTraffic = traffic.errorRate >= Thresholds.errorRatePoor;
        factors.push({
            label: poorTraffic ? 'Many commands are failing in transit' : 'Some commands are being retried',
            detail: `${percent(traffic.errorRate)} of recent controller messages failed (${traffic.errors} of ${traffic.messages + traffic.errors})`,
            impact: poorTraffic ? 25 : 10
        });
    }

    // RF noise floor — the interference signature
    const noise = summarizeNoise(current);
    if (noise) {
        const spike = noise.current - noise.average;

        if (spike >= Thresholds.noiseSpike || noise.current >= Thresholds.noiseLoud) {
            factors.push({
                label: 'RF interference nearby',
                detail: `Noise floor ${noise.current} dBm, ${round(spike)} dB above its average — check for USB 3 devices or powerline adapters near the controller`,
                impact: noise.current >= Thresholds.noiseLoud ? 20 : 12
            });
        }
    }

    factors.sort((a, b) => b.impact - a.impact);

    const score = Math.max(0, Math.min(100, 100 - factors.reduce((total, factor) => total + factor.impact, 0)));

    // A high score alone isn't "healthy": one offline or struggling device costs few
    // points but is exactly what the headline will be talking about, and a card that
    // says "struggling" under a green "healthy" badge reads as broken.
    const hasRealProblem = factors.some(factor => factor.impact >= 10);
    const state = score >= GoodScore && !hasRealProblem
        ? HealthState.Good
        : score >= FairScore ? HealthState.Fair : HealthState.Poor;

    const responding = nodes.length - offline.length;

    return {
        score,
        state,
        headline: headlineFor(state, factors, responding, nodes.length, unmeasured.length),
        factors,
        sampledAt: new Date(now).toISOString(),
        devices: {
            total: nodes.length,
            responding,
            offline: offline.length,
            unmeasured: unmeasured.length
        },
        traffic: {
            messagesPerMinute: round((traffic.messages / Math.max(1, intervalMs)) * 60 * 1000),
            errorRate: round(traffic.errorRate, 3)
        },
        ...(noise ? { noise } : {}),
        nodes
    };
}

function describeNodeProblem(node: INodeHealth, source: INodeTelemetry, now: number): string {
    const parts: string[] = [];

    if (node.dropRate !== undefined && node.dropRate >= Thresholds.nodeDropFair) {
        parts.push(`${percent(node.dropRate)} of commands failed`);
    }
    if (node.rtt !== undefined && node.rtt >= Thresholds.rttFair) {
        parts.push(`${node.rtt} ms round-trip`);
    }
    if (node.rssi !== undefined && node.rssi <= Thresholds.rssiFair) {
        parts.push(`weak signal (${node.rssi} dBm)`);
    }
    if (isStale(source, now)) {
        parts.push('not heard from in over a day');
    }
    if (node.hops !== undefined && node.hops > 0) {
        parts.push(`${node.hops} hop${node.hops === 1 ? '' : 's'} from the controller`);
    }
    if (node.dataRate !== undefined && node.dataRate < 100) {
        parts.push(`${node.dataRate} kbps route`);
    }

    return parts.join(' · ');
}

function summarizeNoise(telemetry: INetworkTelemetry): INetworkHealth['noise'] {
    const channels = telemetry.controller.noise?.channels;
    if (!channels?.length) {
        return undefined;
    }

    // The loudest channel is the one that matters — it is the one drowning out traffic
    const loudest = channels.reduce((worst, channel) => (channel.current > worst.current ? channel : worst));

    return {
        current: Math.round(loudest.current),
        average: Math.round(loudest.average),
        channels: channels.map(channel => Math.round(channel.current))
    };
}

// The sentence at the top of the card
function headlineFor(state: HealthState, factors: IHealthFactor[], responding: number, total: number, unmeasured: number): string {
    if (total === 0) {
        return 'No devices yet';
    }

    if (state === HealthState.Good && factors.length === 0) {
        const subject = total === 1 ? '1 device' : `All ${total} devices`;

        return unmeasured > 0
            ? `${subject} responding; ${unmeasured} not measured yet`
            : `${subject} responding, signal and traffic normal`;
    }

    const lead = factors[0]?.label ?? 'Network is degraded';

    return state === HealthState.Poor
        ? `${lead} — ${responding} of ${total} devices responding`
        : lead;
}

// Fallback when the driver has not produced a usable sample yet (e.g. the very first
// request arrives while the controller is still interviewing)
function emptyHealth(): INetworkHealth {
    return {
        score: 100,
        state: HealthState.Good,
        headline: 'Waiting for the first reading',
        factors: [],
        samples: [],
        sampledAt: new Date().toISOString(),
        devices: { total: 0, responding: 0, offline: 0, unmeasured: 0 },
        traffic: { messagesPerMinute: 0, errorRate: 0 },
        nodes: []
    };
}

class NetworkHealth {
    private server: FastifyInstance;
    private timer: NodeJS.Timeout | undefined;
    private sweepTimer: NodeJS.Timeout | undefined;
    private samples: Sample[];
    private verdict: HealthVerdict | undefined;
    private sweepState: IHealthSweep | undefined;

    constructor(server: FastifyInstance) {
        this.server = server;
        this.samples = [];
    }

    public start(): void {
        this.timer = setInterval(() => this.sample(), SampleIntervalMs);
        this.sweepTimer = setInterval(() => forget(async () => this.sweep()), SweepIntervalMs);

        this.server.log.info({ tags: [ServiceName] }, `Network health sampling every ${SampleIntervalMs / 1000}s, sweeping one device every ${SweepIntervalMs / 1000}s`);
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }

        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = undefined;
        }
    }

    // Latest verdict plus the rolling series and the sweep. Sampled on a tick, but
    // computed on demand the first time so the first request after startup isn't empty.
    public getHealth(): INetworkHealth {
        if (!this.verdict) {
            this.sample();
        }

        if (!this.verdict) {
            return emptyHealth();
        }

        return {
            ...this.verdict,
            samples: this.samples.map(sample => sample.point),
            ...(this.sweepState ? { sweep: this.sweepState } : {})
        };
    }

    private sample(): void {
        try {
            const telemetry = this.server.zwaveService.getNetworkTelemetry();
            const now = Date.now();
            const previous = this.samples.at(-1);
            const interval = previous ? now - previous.at : SampleIntervalMs;

            const verdict = computeHealth(previous?.telemetry, telemetry, interval, now);

            this.verdict = verdict;

            const point: IHealthSample = {
                at: verdict.sampledAt,
                score: verdict.score,
                errorRate: verdict.traffic.errorRate,
                messagesPerMinute: verdict.traffic.messagesPerMinute,
                ...(verdict.noise ? { noise: verdict.noise.current } : {}),
                ...(averageResponseMs(telemetry) !== undefined ? { responseMs: averageResponseMs(telemetry) } : {})
            };

            this.samples.push({ at: now, telemetry, point });

            if (this.samples.length > HistorySize) {
                this.samples.shift();
            }
        }
        catch (ex) {
            // The driver may not be ready yet, or may have gone away; leave the last
            // verdict in place rather than blanking the card
            this.server.log.debug({ tags: [ServiceName] }, `Health sample skipped: ${exMessage(ex)}`);
        }
    }

    // Ping one device per tick, oldest-measured first, so every device produces fresh
    // readings without the mesh ever seeing a burst of traffic.
    private async sweep(): Promise<void> {
        try {
            const telemetry = this.server.zwaveService.getNetworkTelemetry();

            // Sleeping devices would never answer, and waking them would drain them
            const candidates = telemetry.nodes.filter(node => !node.canSleep);
            if (candidates.length === 0) {
                return;
            }

            // Always take the least recently measured device (never-measured devices
            // sort first). The ping updates its lastSeen, so the next tick naturally
            // moves on to the next one — the rotation needs no cursor of its own.
            const target = candidates.reduce((oldest, node) => (seenAt(node) < seenAt(oldest) ? node : oldest));

            this.server.log.debug({ tags: [ServiceName] }, `Health sweep pinging device ${target.nodeId} (${target.name})`);

            // Published while the ping is in flight, so the UI can show the sweep
            // working its way around the mesh rather than looking frozen
            this.sweepState = {
                nodeId: target.nodeId,
                name: target.name,
                active: true,
                at: new Date().toISOString(),
                ok: false
            };

            const startedAt = Date.now();
            const ok = await this.server.zwaveService.pingNode(target.nodeId);

            this.sweepState = {
                nodeId: target.nodeId,
                name: target.name,
                active: false,
                at: new Date().toISOString(),
                ok,
                ...(ok ? { rtt: Date.now() - startedAt } : {})
            };
        }
        catch (ex) {
            if (this.sweepState?.active) {
                this.sweepState = { ...this.sweepState, active: false, at: new Date().toISOString(), ok: false };
            }

            this.server.log.debug({ tags: [ServiceName] }, `Health sweep skipped: ${exMessage(ex)}`);
        }
    }
}

declare module 'fastify' {
    interface FastifyInstance {
        [ServiceName]: NetworkHealth;
    }
}

export default fp(networkHealthPlugin, {
    fastify: '5.x',
    name: ServiceName,
    dependencies: [
        ZWaveServiceName
    ]
});
