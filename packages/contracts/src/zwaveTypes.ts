//
// Service response envelope (shared across all routes)
//
export interface IServiceResponse {
    succeeded: boolean;
    statusCode: number;
    message: string;
    data?: any;
}

export interface IServiceErrorMessage {
    message: string;
}

export interface IServiceReply {
    '2xx': IServiceResponse;
    '4xx': IServiceErrorMessage;
    '5xx': IServiceErrorMessage;
}

//
// Device model
//
export enum DeviceType {
    Switch = 'switch',
    Dimmer = 'dimmer',
    Unknown = 'unknown'
}

export enum DeviceStatus {
    Unknown = 'unknown',
    Asleep = 'asleep',
    Awake = 'awake',
    Dead = 'dead',
    Alive = 'alive'
}

export enum DeviceAction {
    On = 'on',
    Off = 'off',
    Dim = 'dim'
}

// Energy metering (Meter CC). Fields are present only if the device reports them.
export interface IDevicePower {
    watts?: number;
    kWh?: number;
    volts?: number;
    amps?: number;
}

// Passive mesh/link health, read from the driver's accumulated node statistics.
// Values may be absent until the node has exchanged enough traffic. For an active
// reading, use POST /devices/:nodeId/health-check.
export interface IDeviceLink {
    lastSeen?: string;   // ISO date-time
    rtt?: number;        // round-trip time, ms
    rssi?: number;       // signal of the last working route, dBm (negative; closer to 0 = stronger)
    hops?: number;       // repeaters in the route (0 = direct to controller)
}

// Battery CC — not applicable to mains-powered switches/dimmers, included for
// future battery devices (sensors, locks).
export interface IDeviceBattery {
    level?: number;      // percent
    isLow?: boolean;
}

export interface IDeviceInfo {
    nodeId: number;
    name: string;
    location: string;
    type: DeviceType;
    status: DeviceStatus;
    ready: boolean;
    on?: boolean;
    level?: number;
    // While a dimmer is ramping, the target differs from the current `level`
    targetLevel?: number;
    manufacturer?: string;
    product?: string;
    firmwareVersion?: string;
    // Human-readable security class the device joined with (e.g. 'None (insecure)')
    securityClass?: string;
    power?: IDevicePower;
    link?: IDeviceLink;
    battery?: IDeviceBattery;
}

export interface IDeviceParams {
    nodeId: number;
}

// Result of an on-demand lifeline health check (POST /devices/:nodeId/health-check).
export interface IHealthCheckResult {
    rating: number;       // 0 (worst) - 10 (best)
    summary: string;      // human-readable interpretation of the rating
    latencyMs?: number;
    failedPings?: number;
    numNeighbors?: number;
    rssi?: number;        // dBm
}

export interface IDeviceControlRequest {
    action: DeviceAction;
    // Target dim level 0-100, required when action is 'dim' (dimmers only)
    level?: number;
}

//
// Inclusion / Exclusion
//
export enum InclusionStrategyOption {
    Default = 'default',
    Insecure = 'insecure',
    Security_S2 = 's2',
    Security_S0 = 's0',
    SmartStart = 'smartStart'
}

export interface IInclusionRequest {
    strategy?: InclusionStrategyOption;
    // When false, include the device without any security (no S2/S0). This is the
    // simple option for switches/dimmers in a trusted environment. Overrides
    // `strategy` when set to false. Defaults to using `strategy` (or the driver
    // default) when omitted.
    secure?: boolean;
    // 5-digit DSK PIN from the device label, required for authenticated S2 inclusion
    pin?: string;
}

//
// Rooms (a named group of devices)
//
export interface IRoom {
    id: string;
    name: string;
    deviceIds: number[];
}

export interface IRoomParams {
    roomId: string;
}

export interface ICreateRoomRequest {
    name: string;
    deviceIds: number[];
}

export interface IUpdateRoomRequest {
    name?: string;
    deviceIds?: number[];
}

export interface IRoomControlRequest {
    action: DeviceAction;
    level?: number;
}

//
// Scenes (a named set of devices, each with an action, belonging to a room)
//
export enum SceneTrigger {
    // Activated on demand, via the API or the web UI
    Manual = 'manual',
    // Activated automatically by the scheduler, per the scene's `schedule`
    Scheduled = 'scheduled'
}

//
// Scheduling
//
export enum ScheduleKind {
    // Every N seconds/minutes/hours/days, from when the schedule was set
    Interval = 'interval',
    // Every day at a time of day
    Daily = 'daily',
    // On selected weekdays at a time of day
    Weekly = 'weekly',
    // On selected days of the month at a time of day
    Monthly = 'monthly',
    // Once, at a specific date and time
    Once = 'once'
}

export enum IntervalUnit {
    Seconds = 'seconds',
    Minutes = 'minutes',
    Hours = 'hours',
    Days = 'days'
}

export enum TimeOfDayKind {
    // A wall-clock time (see ITimeOfDay.time)
    Clock = 'clock',
    // Relative to sunrise/sunset for the configured latitude/longitude
    Sunrise = 'sunrise',
    Sunset = 'sunset'
}

// When during a day something happens: either a clock time, or an offset from a
// solar event. Shared by the daily/weekly/monthly schedule kinds.
export interface ITimeOfDay {
    kind: TimeOfDayKind;
    // 'HH:MM' (24h, local time) — required when kind is 'clock'
    time?: string;
    // Offset from the solar event in minutes: negative = before, positive = after,
    // 0/omitted = at the event. Only used when kind is 'sunrise' or 'sunset'.
    offsetMinutes?: number;
}

// All times are evaluated in the service's local timezone (set TZ in the container).
export interface ISchedule {
    kind: ScheduleKind;
    // kind = 'interval'
    every?: number;
    unit?: IntervalUnit;
    // kind = 'daily' | 'weekly' | 'monthly'
    timeOfDay?: ITimeOfDay;
    // kind = 'weekly': 0 (Sunday) - 6 (Saturday)
    daysOfWeek?: number[];
    // kind = 'monthly': 1 - 31 (days past the end of a month are skipped)
    daysOfMonth?: number[];
    // kind = 'once': ISO date-time
    at?: string;
}

// A device participating in a scene, and what it should do when the scene activates
export interface ISceneDevice {
    deviceId: number;
    action: DeviceAction;
    // Target level 0-100, required when action is 'dim' (dimmers only)
    level?: number;
}

export interface IScene {
    id: string;
    name: string;
    // The room this scene belongs to
    roomId: string;
    trigger: SceneTrigger;
    // Required when trigger is 'scheduled'; ignored otherwise
    schedule?: ISchedule;
    devices: ISceneDevice[];
}

export interface ISceneParams {
    sceneId: string;
}

export interface ICreateSceneRequest {
    name: string;
    roomId: string;
    trigger: SceneTrigger;
    schedule?: ISchedule;
    devices: ISceneDevice[];
}

export interface IUpdateSceneRequest {
    name?: string;
    roomId?: string;
    trigger?: SceneTrigger;
    schedule?: ISchedule;
    devices?: ISceneDevice[];
}
