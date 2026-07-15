export {
    IServiceResponse,
    IServiceErrorMessage,
    IServiceReply,
    DeviceType,
    DeviceStatus,
    DeviceAction,
    IDeviceInfo,
    IDeviceParams,
    IDeviceControlRequest,
    InclusionStrategyOption,
    IInclusionRequest,
    IRoom,
    IRoomParams,
    ICreateRoomRequest,
    IUpdateRoomRequest,
    IRoomControlRequest,
    ISceneLevel,
    IScene,
    ISceneParams,
    ICreateSceneRequest,
    IUpdateSceneRequest
} from '@zwave-service/contracts';

import IServiceResponseSchemaRaw from './schemas/IServiceResponseSchema.json' with { type: 'json' };
import IServiceErrorMessageSchemaRaw from './schemas/IServiceErrorMessageSchema.json' with { type: 'json' };
import IDeviceControlRequestSchemaRaw from './schemas/IDeviceControlRequestSchema.json' with { type: 'json' };
import IDeviceParamsSchemaRaw from './schemas/IDeviceParamsSchema.json' with { type: 'json' };
import IInclusionRequestSchemaRaw from './schemas/IInclusionRequestSchema.json' with { type: 'json' };
import ICreateRoomRequestSchemaRaw from './schemas/ICreateRoomRequestSchema.json' with { type: 'json' };
import IUpdateRoomRequestSchemaRaw from './schemas/IUpdateRoomRequestSchema.json' with { type: 'json' };
import IRoomParamsSchemaRaw from './schemas/IRoomParamsSchema.json' with { type: 'json' };
import IRoomControlRequestSchemaRaw from './schemas/IRoomControlRequestSchema.json' with { type: 'json' };
import ICreateSceneRequestSchemaRaw from './schemas/ICreateSceneRequestSchema.json' with { type: 'json' };
import IUpdateSceneRequestSchemaRaw from './schemas/IUpdateSceneRequestSchema.json' with { type: 'json' };
import ISceneParamsSchemaRaw from './schemas/ISceneParamsSchema.json' with { type: 'json' };

// Strip the top-level `$id` so each schema can be compiled inline on multiple
// routes without ajv reporting a duplicate schema id. The internal
// `#/definitions` `$ref` still resolves against the schema root.
function stripSchemaId(schema: Record<string, any>): Record<string, any> {
    const clone = { ...schema };

    delete clone.$id;

    return clone;
}

const IServiceResponseSchema = stripSchemaId(IServiceResponseSchemaRaw);
const IServiceErrorMessageSchema = stripSchemaId(IServiceErrorMessageSchemaRaw);
const IDeviceControlRequestSchema = stripSchemaId(IDeviceControlRequestSchemaRaw);
const IDeviceParamsSchema = stripSchemaId(IDeviceParamsSchemaRaw);
const IInclusionRequestSchema = stripSchemaId(IInclusionRequestSchemaRaw);
const ICreateRoomRequestSchema = stripSchemaId(ICreateRoomRequestSchemaRaw);
const IUpdateRoomRequestSchema = stripSchemaId(IUpdateRoomRequestSchemaRaw);
const IRoomParamsSchema = stripSchemaId(IRoomParamsSchemaRaw);
const IRoomControlRequestSchema = stripSchemaId(IRoomControlRequestSchemaRaw);
const ICreateSceneRequestSchema = stripSchemaId(ICreateSceneRequestSchemaRaw);
const IUpdateSceneRequestSchema = stripSchemaId(IUpdateSceneRequestSchemaRaw);
const ISceneParamsSchema = stripSchemaId(ISceneParamsSchemaRaw);

export {
    IServiceResponseSchema,
    IServiceErrorMessageSchema,
    IDeviceControlRequestSchema,
    IDeviceParamsSchema,
    IInclusionRequestSchema,
    ICreateRoomRequestSchema,
    IUpdateRoomRequestSchema,
    IRoomParamsSchema,
    IRoomControlRequestSchema,
    ICreateSceneRequestSchema,
    IUpdateSceneRequestSchema,
    ISceneParamsSchema
};
