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

export interface IDeviceInfo {
    nodeId: number;
    name: string;
    location: string;
    type: DeviceType;
    status: DeviceStatus;
    ready: boolean;
    on?: boolean;
    level?: number;
    manufacturer?: string;
    product?: string;
}

export interface IDeviceParams {
    nodeId: number;
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
// Scenes (a named set of devices each at a specific level)
//
export interface ISceneLevel {
    deviceId: number;
    // Target level 0-100 (0 = off, 100 = full). Applied as on/off for switches.
    level: number;
}

export interface IScene {
    id: string;
    name: string;
    levels: ISceneLevel[];
}

export interface ISceneParams {
    sceneId: string;
}

export interface ICreateSceneRequest {
    name: string;
    levels: ISceneLevel[];
}

export interface IUpdateSceneRequest {
    name?: string;
    levels?: ISceneLevel[];
}
