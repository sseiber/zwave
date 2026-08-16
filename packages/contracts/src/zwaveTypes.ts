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
    // Human-readable name + label, present only when the device is matched to a
    // zwave-js config file (else the device shows as "unknown")
    manufacturer?: string;
    product?: string;
    // Raw Manufacturer Specific CC IDs (hex, e.g. '0x0063'), present once the node is
    // interviewed even if no config file matches. Useful to identify an "unknown"
    // device and look it up in the zwave-js device database.
    manufacturerId?: string;
    productType?: string;
    productId?: string;
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

// Progress of a network-wide route rebuild (GET /rebuild-routes). `active` is true
// while the controller is rebuilding; the counts summarize per-node status.
export interface IRebuildRoutesStatus {
    active: boolean;
    total: number;
    done: number;
    failed: number;
    skipped: number;
    pending: number;
}

// Status of the zwave-js device-configuration database (POST /config-db/check).
// zwave-js names/describes device parameters from this DB; refreshing it can identify
// devices whose model wasn't in the bundled version.
export interface IConfigDbStatus {
    updateAvailable: boolean;
    // The newer config-DB version available to install, when updateAvailable is true
    version?: string;
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
// Device configuration parameters (Z-Wave Configuration CC). Names/ranges/options
// come from the zwave-js device database, so they are device-specific — e.g. a Jasco
// dimmer's ramp-rate settings, which cannot be changed at the wall.
//
export interface IConfigParamOption {
    value: number;
    label: string;
}

export interface IDeviceConfigParam {
    parameter: number;        // Configuration CC parameter number
    bitmask?: number;         // set for a partial (bitmasked) parameter
    label: string;            // human-readable name (falls back to 'Parameter <n>')
    description?: string;
    value?: number;           // current cached value (absent if never read from the device)
    min?: number;
    max?: number;
    default?: number;
    unit?: string;
    // Present when the parameter is an enumerated choice (e.g. Off/Low/High)
    options?: IConfigParamOption[];
    // Whether any value in min..max may be entered, vs only the listed options
    allowManualEntry: boolean;
    readOnly: boolean;
    advanced?: boolean;
}

// Set one configuration parameter (PUT /devices/:nodeId/config)
export interface ISetConfigParamRequest {
    parameter: number;
    bitmask?: number;
    value: number;
}

// Rename a device. The name is stored in the zwave-js network cache (not on the
// device), so it persists across restarts as long as the storage volume survives.
// An empty string clears the name, and the UI falls back to "Node <id>".
export interface IUpdateDeviceRequest {
    name: string;
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
// Network health (GET /network/health)
//
// A composite view rather than a wall of gauges: the service samples controller
// statistics, per-node reliability and the RF noise floor on a tick, folds them into a
// single 0-100 score, and explains that score in plain language. The individual
// readings are still exposed so the UI can show what drove the verdict.
//

export enum HealthState {
    Good = 'good',
    Fair = 'fair',
    Poor = 'poor'
}

export enum NodeHealthState {
    Good = 'good',
    Fair = 'fair',
    Poor = 'poor',
    // The driver has marked the node dead
    Offline = 'offline',
    // Nothing measured yet — no traffic has reached this node since startup
    Unknown = 'unknown'
}

// One reason the score is not 100, phrased for a person
export interface IHealthFactor {
    // e.g. "Garage overhead is dropping commands"
    label: string;
    // Supporting numbers, e.g. "3 of 12 commands failed"
    detail?: string;
    // Points this subtracted from the score
    impact: number;
    // What to actually do about it — absent when the honest answer is "nothing"
    suggestion?: string;
    // Device this concerns, when it is about one device
    nodeId?: number;
}

// Per-device health, folded from reliability, latency, signal and last-seen
export interface INodeHealth {
    nodeId: number;
    name: string;
    state: NodeHealthState;
    // Share of commands to this device that were dropped or timed out (0-1)
    dropRate?: number;
    rtt?: number;         // ms, moving average
    rssi?: number;        // dBm
    hops?: number;        // repeaters between the controller and the device
    dataRate?: number;    // kbps of the last working route (9.6 / 40 / 100)
    lastSeen?: string;    // ISO date-time
}

// Controller traffic over the most recent sampling interval
export interface IHealthTraffic {
    messagesPerMinute: number;
    // Share of messages that were dropped, NAK'd, collided or timed out (0-1)
    errorRate: number;
}

// RF noise floor. `current` well above `average` is the signature of interference.
export interface IHealthNoise {
    current: number;      // dBm, strongest (least negative) channel right now
    average: number;      // dBm, moving average of the same channel
    channels: number[];   // current dBm per channel
}

// One point in the rolling series behind the health chart
export interface IHealthSample {
    at: string;                  // ISO date-time
    score: number;
    noise?: number;              // RF noise floor, dBm (absent if the stick doesn't report it)
    errorRate: number;           // share of controller messages that failed, 0-1
    messagesPerMinute: number;
    responseMs?: number;         // average round-trip time across measured devices
}

// The background sweep: which device the service is measuring, or measured last. This
// is what makes the health view visibly live between user actions.
export interface IHealthSweep {
    nodeId: number;
    name: string;
    // True while the ping is in flight
    active: boolean;
    at: string;                  // ISO date-time the last sweep completed
    ok: boolean;
    rtt?: number;                // ms, measured around the ping
}

export interface INetworkHealth {
    score: number;        // 0 (worst) - 100 (best)
    state: HealthState;
    // One-sentence plain-language verdict
    headline: string;
    // What the user should do about it, including "nothing" when that's the truth.
    // A mesh of older devices sits at less than 100 and is still working as well as it
    // ever will; this is where that gets said out loud.
    advice: string;
    // What is holding the score down, worst first; empty when everything is fine
    factors: IHealthFactor[];
    // Rolling series behind the chart, oldest first (~2 hours at the sampling interval)
    samples: IHealthSample[];
    // The device the sweep is measuring, or measured most recently
    sweep?: IHealthSweep;
    sampledAt: string;
    devices: {
        total: number;
        responding: number;
        offline: number;
        // Devices with no measurements yet
        unmeasured: number;
    };
    traffic: IHealthTraffic;
    noise?: IHealthNoise;
    nodes: INodeHealth[];
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
// Scenes (a named set of devices, each with an action)
//
// Every scene is always manually activatable (API / web UI). A scene may ALSO carry
// zero or more `schedules`; each one independently fires the scene. There is no
// manual-vs-scheduled mode — an outdoor scene can run 90 min before sunset AND 60 min
// before sunrise while still being activatable on demand.
//

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
    // Optional organizational label; does NOT constrain which devices the scene
    // controls. A scene's devices can span any rooms (or none), so a catch-all like
    // "House.Off" needs no room.
    roomId?: string;
    // Zero or more automatic triggers; each independently fires the scene. Absent or
    // empty = manual-only. The scene is always manually activatable regardless.
    schedules?: ISchedule[];
    devices: ISceneDevice[];
}

export interface ISceneParams {
    sceneId: string;
}

// Outcome of a scene activation, recorded so the UI can show the last result.
export interface ISceneRunResult {
    succeeded: boolean;
    message: string;
}

// Runtime status for a scene (GET /scenes/status). Computed/merged, never stored on
// the scene itself: `nextRun` comes from the scheduler (scheduled scenes only),
// `lastRun`/`lastResult` from the persisted run record (manual or scheduled).
export interface ISceneStatus {
    sceneId: string;
    // ISO date-time of the soonest upcoming run across all of the scene's schedules
    // (absent if the scene has no schedules or none has a future run)
    nextRun?: string;
    lastRun?: string;    // ISO date-time of the most recent activation
    lastResult?: ISceneRunResult;
}

export interface ICreateSceneRequest {
    name: string;
    // Optional label (see IScene.roomId); scenes are not scoped to a room
    roomId?: string;
    schedules?: ISchedule[];
    devices: ISceneDevice[];
}

export interface IUpdateSceneRequest {
    name?: string;
    roomId?: string;
    schedules?: ISchedule[];
    devices?: ISceneDevice[];
}
