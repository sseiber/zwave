import { FastifyInstance } from 'fastify';
import { resolve as pathResolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import fse from 'fs-extra';
import {
    Driver,
    InclusionStrategy,
    ZWaveNode
} from 'zwave-js';
import { CommandClasses, NodeStatus, SecurityClass } from '@zwave-js/core';
import {
    DeviceType,
    DeviceStatus,
    IDeviceInfo,
    IDevicePower,
    IDeviceLink,
    IDeviceBattery,
    IHealthCheckResult,
    InclusionStrategyOption
} from '../models/index.js';
import { exMessage } from '../utils/index.js';

export const ControllerName = 'zwaveController';

const SecurityKeysFileName = 'securityKeys.json';
const CacheDirName = 'cache';

// Z-Wave Multilevel Switch values are 0-99 (0 = off, 99 = full brightness)
const ZWaveMaxLevel = 99;

interface ISecurityKeys {
    S0_Legacy: string;
    S2_Unauthenticated: string;
    S2_Authenticated: string;
    S2_AccessControl: string;
    LR_S2_Authenticated: string;
    LR_S2_AccessControl: string;
}

export class ZWaveController {
    public static async createController(server: FastifyInstance): Promise<ZWaveController> {
        const storagePath = server.config.env.zwaveStorage;
        const serialPort = server.config.env.zwaveSerialPort;

        server.log.info({ tags: [ControllerName] }, `Creating Z-Wave controller on serial port ${serialPort}`);

        const keys = await ZWaveController.loadOrCreateKeys(server, storagePath);

        const controller = new ZWaveController(server, serialPort, storagePath, keys);

        await controller.init();

        return controller;
    }

    private static async loadOrCreateKeys(server: FastifyInstance, storagePath: string): Promise<ISecurityKeys> {
        const keysPath = pathResolve(storagePath, SecurityKeysFileName);

        // Allow explicit overrides via environment variables
        const envKeys: Partial<ISecurityKeys> = {
            S0_Legacy: process.env.ZWAVE_S0_LEGACY_KEY,
            S2_Unauthenticated: process.env.ZWAVE_S2_UNAUTHENTICATED_KEY,
            S2_Authenticated: process.env.ZWAVE_S2_AUTHENTICATED_KEY,
            S2_AccessControl: process.env.ZWAVE_S2_ACCESS_CONTROL_KEY,
            LR_S2_Authenticated: process.env.ZWAVE_LR_S2_AUTHENTICATED_KEY,
            LR_S2_AccessControl: process.env.ZWAVE_LR_S2_ACCESS_CONTROL_KEY
        };

        let keys: ISecurityKeys;

        if (await fse.pathExists(keysPath)) {
            keys = await fse.readJson(keysPath) as ISecurityKeys;

            server.log.info({ tags: [ControllerName] }, `Loaded Z-Wave security keys from ${keysPath}`);
        }
        else {
            keys = {
                S0_Legacy: randomBytes(16).toString('hex'),
                S2_Unauthenticated: randomBytes(16).toString('hex'),
                S2_Authenticated: randomBytes(16).toString('hex'),
                S2_AccessControl: randomBytes(16).toString('hex'),
                LR_S2_Authenticated: randomBytes(16).toString('hex'),
                LR_S2_AccessControl: randomBytes(16).toString('hex')
            };

            await fse.writeJson(keysPath, keys, { spaces: 4, mode: 0o600 });

            server.log.info({ tags: [ControllerName] }, `Generated new Z-Wave security keys and saved them to ${keysPath}`);
        }

        // Environment overrides take precedence over persisted/generated values
        for (const key of Object.keys(keys) as (keyof ISecurityKeys)[]) {
            if (envKeys[key]) {
                keys[key] = envKeys[key];
            }
        }

        return keys;
    }

    private server: FastifyInstance;
    private serialPort: string;
    private storagePath: string;
    private keys: ISecurityKeys;
    private driver: Driver;
    private ready: boolean;
    private pendingInclusionPin: string | undefined;

    constructor(server: FastifyInstance, serialPort: string, storagePath: string, keys: ISecurityKeys) {
        this.server = server;
        this.serialPort = serialPort;
        this.storagePath = storagePath;
        this.keys = keys;
        this.ready = false;
        this.pendingInclusionPin = undefined;

        this.driver = new Driver(this.serialPort, {
            securityKeys: {
                S0_Legacy: Buffer.from(this.keys.S0_Legacy, 'hex'),
                S2_Unauthenticated: Buffer.from(this.keys.S2_Unauthenticated, 'hex'),
                S2_Authenticated: Buffer.from(this.keys.S2_Authenticated, 'hex'),
                S2_AccessControl: Buffer.from(this.keys.S2_AccessControl, 'hex')
            },
            securityKeysLongRange: {
                S2_Authenticated: Buffer.from(this.keys.LR_S2_Authenticated, 'hex'),
                S2_AccessControl: Buffer.from(this.keys.LR_S2_AccessControl, 'hex')
            },
            storage: {
                cacheDir: pathResolve(this.storagePath, CacheDirName)
            },
            inclusionUserCallbacks: {
                grantSecurityClasses: async requested => await Promise.resolve(requested),
                validateDSKAndEnterPIN: async _dsk => await Promise.resolve(this.pendingInclusionPin ?? ''),
                abort: () => {
                    this.server.log.warn({ tags: [ControllerName] }, `Secure inclusion aborted`);
                }
            },
            logConfig: {
                enabled: true,
                level: 'info'
            }
        });
    }

    public async init(): Promise<void> {
        this.driver.on('error', (err) => {
            this.server.log.error({ tags: [ControllerName] }, `Driver error: ${exMessage(err)}`);
        });

        this.driver.once('driver ready', () => {
            this.server.log.info({ tags: [ControllerName] }, `Driver ready - home id: ${this.driver.controller.homeId?.toString(16)}`);

            this.wireControllerEvents();

            for (const node of this.driver.controller.nodes.values()) {
                this.wireNodeEvents(node);
            }

            this.ready = true;
        });

        try {
            await this.driver.start();

            this.server.log.info({ tags: [ControllerName] }, `Driver started, waiting for controller interview to complete...`);
        }
        catch (ex) {
            throw new Error(`Failed to start Z-Wave driver on ${this.serialPort}: ${exMessage(ex)}`);
        }
    }

    public async destroy(): Promise<void> {
        try {
            await this.driver.destroy();
        }
        catch (ex) {
            this.server.log.error({ tags: [ControllerName] }, `Error destroying driver: ${exMessage(ex)}`);
        }
    }

    public isReady(): boolean {
        return this.ready;
    }

    //
    // Inclusion / Exclusion
    //
    public async beginInclusion(strategyOption?: InclusionStrategyOption, pin?: string, secure?: boolean): Promise<boolean> {
        this.assertReady();

        this.pendingInclusionPin = pin;

        // An explicit `secure: false` forces insecure inclusion regardless of `strategy`
        const strategy = secure === false
            ? InclusionStrategy.Insecure
            : this.mapInclusionStrategy(strategyOption);

        this.server.log.info({ tags: [ControllerName] }, `Beginning inclusion with strategy ${InclusionStrategy[strategy]}`);

        return this.driver.controller.beginInclusion({ strategy });
    }

    public async stopInclusion(): Promise<boolean> {
        this.assertReady();

        this.pendingInclusionPin = undefined;

        this.server.log.info({ tags: [ControllerName] }, `Stopping inclusion`);

        return this.driver.controller.stopInclusion();
    }

    public async beginExclusion(): Promise<boolean> {
        this.assertReady();

        this.server.log.info({ tags: [ControllerName] }, `Beginning exclusion`);

        return this.driver.controller.beginExclusion();
    }

    public async stopExclusion(): Promise<boolean> {
        this.assertReady();

        this.server.log.info({ tags: [ControllerName] }, `Stopping exclusion`);

        return this.driver.controller.stopExclusion();
    }

    //
    // Devices
    //
    public listDevices(): IDeviceInfo[] {
        this.assertReady();

        const devices: IDeviceInfo[] = [];

        for (const node of this.driver.controller.nodes.values()) {
            // Skip the controller node itself
            if (node.isControllerNode) {
                continue;
            }

            devices.push(this.describeNode(node));
        }

        return devices;
    }

    public getDevice(nodeId: number): IDeviceInfo {
        this.assertReady();

        return this.describeNode(this.getNode(nodeId));
    }

    public async setDevicePower(nodeId: number, on: boolean): Promise<void> {
        this.assertReady();

        const node = this.getNode(nodeId);
        const type = this.deviceType(node);

        if (type === DeviceType.Dimmer) {
            await node.commandClasses['Multilevel Switch'].set(on ? ZWaveMaxLevel : 0);
        }
        else if (type === DeviceType.Switch) {
            await node.commandClasses['Binary Switch'].set(on);
        }
        else {
            throw new Error(`Device ${nodeId} is not a controllable switch or dimmer`);
        }
    }

    public async setDeviceLevel(nodeId: number, level: number): Promise<void> {
        this.assertReady();

        const node = this.getNode(nodeId);
        const type = this.deviceType(node);

        if (type !== DeviceType.Dimmer) {
            throw new Error(`Device ${nodeId} is not a dimmer and cannot accept a dim level`);
        }

        await node.commandClasses['Multilevel Switch'].set(this.toZWaveLevel(level));
    }

    // On-demand lifeline health check. This actively pings the device (a few rounds),
    // so it is a deliberate action rather than something polled. Returns an overall
    // rating plus the underlying latency/signal so a weak node can be spotted.
    public async checkDeviceHealth(nodeId: number, rounds = 3): Promise<IHealthCheckResult> {
        this.assertReady();

        const node = this.getNode(nodeId);

        this.server.log.info({ tags: [ControllerName] }, `Running lifeline health check for device ${nodeId} (${rounds} rounds)`);

        const summary = await node.checkLifelineHealth(rounds);
        const results = summary.results ?? [];

        const latencies = results.map(result => result.latency).filter((value): value is number => typeof value === 'number');
        const failedPings = results.reduce((total, result) => total + (result.failedPingsNode ?? 0), 0);
        const lastResult = results.at(-1);

        // rssi is not on every zwave-js version's result shape; read it defensively
        const rssiValues = results
            .map(result => (result as { rssi?: number }).rssi)
            .filter((value): value is number => typeof value === 'number' && value < 0);

        return {
            rating: summary.rating,
            summary: this.healthRatingText(summary.rating),
            latencyMs: latencies.length > 0 ? Math.max(...latencies) : undefined,
            failedPings,
            numNeighbors: lastResult?.numNeighbors,
            rssi: rssiValues.length > 0 ? Math.max(...rssiValues) : undefined
        };
    }

    private healthRatingText(rating: number): string {
        if (rating >= 9) {
            return 'Excellent';
        }
        if (rating >= 7) {
            return 'Good';
        }
        if (rating >= 5) {
            return 'Acceptable';
        }
        if (rating >= 3) {
            return 'Poor — consider a repeater or moving the device';
        }

        return 'Very poor — the device is barely reachable';
    }

    //
    // Internal helpers
    //
    private assertReady(): void {
        if (!this.ready) {
            throw new Error(`The Z-Wave controller is not ready yet`);
        }
    }

    private getNode(nodeId: number): ZWaveNode {
        const node = this.driver.controller.nodes.get(nodeId);
        if (!node) {
            throw new Error(`No device found with nodeId ${nodeId}`);
        }

        return node;
    }

    private deviceType(node: ZWaveNode): DeviceType {
        if (node.supportsCC(CommandClasses['Multilevel Switch'])) {
            return DeviceType.Dimmer;
        }

        if (node.supportsCC(CommandClasses['Binary Switch'])) {
            return DeviceType.Switch;
        }

        return DeviceType.Unknown;
    }

    private describeNode(node: ZWaveNode): IDeviceInfo {
        const type = this.deviceType(node);

        const info: IDeviceInfo = {
            nodeId: node.id,
            name: node.name ?? '',
            location: node.location ?? '',
            type,
            status: this.mapNodeStatus(node.status),
            ready: node.ready,
            manufacturer: node.deviceConfig?.manufacturer,
            product: node.deviceConfig?.label
        };

        if (type === DeviceType.Dimmer) {
            const level = node.getValue({ commandClass: CommandClasses['Multilevel Switch'], property: 'currentValue' }) as number | undefined;
            if (level !== undefined) {
                info.level = this.fromZWaveLevel(level);
                info.on = level > 0;
            }

            const target = node.getValue({ commandClass: CommandClasses['Multilevel Switch'], property: 'targetValue' }) as number | undefined;
            if (target !== undefined) {
                info.targetLevel = this.fromZWaveLevel(target);
            }
        }
        else if (type === DeviceType.Switch) {
            const on = node.getValue({ commandClass: CommandClasses['Binary Switch'], property: 'currentValue' }) as boolean | undefined;
            if (on !== undefined) {
                info.on = on;
            }
        }

        // Everything below is capability-gated: only present if the device reports it.
        // First-gen (non-Plus) devices in particular will populate few of these.
        const firmwareVersion = node.firmwareVersion;
        if (firmwareVersion) {
            info.firmwareVersion = firmwareVersion;
        }

        const securityClass = this.securityClassLabel(node.getHighestSecurityClass());
        if (securityClass) {
            info.securityClass = securityClass;
        }

        const power = this.readPower(node);
        if (power) {
            info.power = power;
        }

        const link = this.readLink(node);
        if (link) {
            info.link = link;
        }

        const battery = this.readBattery(node);
        if (battery) {
            info.battery = battery;
        }

        return info;
    }

    // Energy metering (Meter CC). Meter value IDs encode their scale in the propertyKey,
    // so read the unit from each value's metadata rather than guessing propertyKeys.
    private readPower(node: ZWaveNode): IDevicePower | undefined {
        if (!node.supportsCC(CommandClasses.Meter)) {
            return undefined;
        }

        const power: IDevicePower = {};
        let found = false;

        for (const valueId of node.getDefinedValueIDs()) {
            if (valueId.commandClass !== CommandClasses.Meter || valueId.property !== 'value') {
                continue;
            }

            const value = node.getValue(valueId);
            if (typeof value !== 'number') {
                continue;
            }

            const unit = (node.getValueMetadata(valueId) as { unit?: string }).unit;
            switch (unit) {
                case 'W':
                    power.watts = value;
                    found = true;
                    break;
                case 'kWh':
                    power.kWh = value;
                    found = true;
                    break;
                case 'V':
                    power.volts = value;
                    found = true;
                    break;
                case 'A':
                    power.amps = value;
                    found = true;
                    break;

                default:
                    break;
            }
        }

        return found ? power : undefined;
    }

    private readLink(node: ZWaveNode): IDeviceLink | undefined {
        const stats = node.statistics;
        const link: IDeviceLink = {};

        if (node.lastSeen) {
            link.lastSeen = node.lastSeen.toISOString();
        }
        if (typeof stats.rtt === 'number') {
            link.rtt = stats.rtt;
        }

        // Real RSSI values are negative dBm; 125-127 are error/"not available" sentinels
        const rssi = stats.rssi ?? stats.lwr?.rssi;
        if (typeof rssi === 'number' && rssi < 0) {
            link.rssi = rssi;
        }
        if (stats.lwr?.repeaters) {
            link.hops = stats.lwr.repeaters.length;
        }

        return Object.keys(link).length > 0 ? link : undefined;
    }

    private readBattery(node: ZWaveNode): IDeviceBattery | undefined {
        if (!node.supportsCC(CommandClasses.Battery)) {
            return undefined;
        }

        const battery: IDeviceBattery = {};

        const level = node.getValue({ commandClass: CommandClasses.Battery, property: 'level' }) as number | undefined;
        if (typeof level === 'number') {
            battery.level = level;
        }

        const isLow = node.getValue({ commandClass: CommandClasses.Battery, property: 'isLow' }) as boolean | undefined;
        if (typeof isLow === 'boolean') {
            battery.isLow = isLow;
        }

        return Object.keys(battery).length > 0 ? battery : undefined;
    }

    private securityClassLabel(securityClass: SecurityClass | undefined): string | undefined {
        switch (securityClass) {
            case SecurityClass.None:
                return 'None (insecure)';
            case SecurityClass.S2_Unauthenticated:
                return 'S2 Unauthenticated';
            case SecurityClass.S2_Authenticated:
                return 'S2 Authenticated';
            case SecurityClass.S2_AccessControl:
                return 'S2 Access Control';
            case SecurityClass.S0_Legacy:
                return 'S0 Legacy';

            default:
                return undefined;
        }
    }

    private mapNodeStatus(status: NodeStatus): DeviceStatus {
        switch (status) {
            case NodeStatus.Asleep:
                return DeviceStatus.Asleep;

            case NodeStatus.Awake:
                return DeviceStatus.Awake;

            case NodeStatus.Dead:
                return DeviceStatus.Dead;

            case NodeStatus.Alive:
                return DeviceStatus.Alive;

            default:
                return DeviceStatus.Unknown;
        }
    }

    private mapInclusionStrategy(strategyOption?: InclusionStrategyOption): InclusionStrategy.Default | InclusionStrategy.Insecure | InclusionStrategy.Security_S0 | InclusionStrategy.Security_S2 {
        switch (strategyOption) {
            case InclusionStrategyOption.Insecure:
                return InclusionStrategy.Insecure;

            case InclusionStrategyOption.Security_S2:
                return InclusionStrategy.Security_S2;

            case InclusionStrategyOption.Security_S0:
                return InclusionStrategy.Security_S0;

            case InclusionStrategyOption.Default:
            case InclusionStrategyOption.SmartStart:
            default:
                return InclusionStrategy.Default;
        }
    }

    private toZWaveLevel(level: number): number {
        const clamped = Math.max(0, Math.min(100, Math.round(level)));

        return Math.round((clamped * ZWaveMaxLevel) / 100);
    }

    private fromZWaveLevel(level: number): number {
        const clamped = Math.max(0, Math.min(ZWaveMaxLevel, level));

        return Math.round((clamped * 100) / ZWaveMaxLevel);
    }

    private wireControllerEvents(): void {
        const controller = this.driver.controller;

        controller.on('inclusion started', () => {
            this.server.log.info({ tags: [ControllerName] }, `Inclusion started`);
        });

        controller.on('inclusion stopped', () => {
            this.pendingInclusionPin = undefined;
            this.server.log.info({ tags: [ControllerName] }, `Inclusion stopped`);
        });

        controller.on('inclusion failed', () => {
            this.pendingInclusionPin = undefined;
            this.server.log.error({ tags: [ControllerName] }, `Inclusion failed`);
        });

        controller.on('exclusion started', () => {
            this.server.log.info({ tags: [ControllerName] }, `Exclusion started`);
        });

        controller.on('exclusion stopped', () => {
            this.server.log.info({ tags: [ControllerName] }, `Exclusion stopped`);
        });

        controller.on('exclusion failed', () => {
            this.server.log.error({ tags: [ControllerName] }, `Exclusion failed`);
        });

        controller.on('node added', (node) => {
            this.server.log.info({ tags: [ControllerName] }, `Node ${node.id} added`);
            this.wireNodeEvents(node);
        });

        controller.on('node removed', (node) => {
            this.server.log.info({ tags: [ControllerName] }, `Node ${node.id} removed`);
        });
    }

    private wireNodeEvents(node: ZWaveNode): void {
        node.on('ready', (readyNode) => {
            this.server.log.info({ tags: [ControllerName] }, `Node ${readyNode.id} ready: ${readyNode.deviceConfig?.label ?? 'unknown device'}`);
        });

        node.on('dead', (deadNode) => {
            this.server.log.warn({ tags: [ControllerName] }, `Node ${deadNode.id} is dead`);
        });
    }
}
