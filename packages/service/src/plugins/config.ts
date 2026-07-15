import {
    envSchema,
    JSONSchemaType
} from 'env-schema';
import {
    FastifyInstance,
    FastifyPluginAsync
} from 'fastify';
import fp from 'fastify-plugin';
import {
    resolve as pathResolve
} from 'node:path';
import fse from 'fs-extra';
import { getDirname, exMessage } from '../utils/index.js';

export const PluginName = 'config';

interface IZWaveEnv {
    LOG_LEVEL: string;
    PORT: string;
    zwaveStorage: string;
    zwaveSerialPort: string;
    webClientRoot: string;
}

interface IZWaveConfig {
    env: IZWaveEnv;
}

const configSchema: JSONSchemaType<IZWaveEnv> = {
    type: 'object',
    properties: {
        LOG_LEVEL: {
            type: 'string',
            default: 'debug'
        },
        PORT: {
            type: 'string',
            default: '9094'
        },
        zwaveStorage: {
            type: 'string',
            default: '/rpi-zwave/data'
        },
        zwaveSerialPort: {
            type: 'string',
            default: '/dev/ttyACM0'
        },
        webClientRoot: {
            type: 'string',
            default: '/app/web'
        }
    },
    required: [
        'LOG_LEVEL',
        'PORT',
        'zwaveStorage',
        'zwaveSerialPort',
        'webClientRoot'
    ]
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface IConfigPluginOptions { }

const configPlugin: FastifyPluginAsync<IConfigPluginOptions> = async (server: FastifyInstance, _options: IConfigPluginOptions): Promise<void> => {
    server.log.info({ tags: [PluginName] }, `Registering...`);

    try {
        const envConfig = envSchema<IZWaveEnv>({
            schema: configSchema,
            data: process.env,
            dotenv: {
                path: pathResolve(getDirname(import.meta.url), `../../configs/${process.env.NODE_ENV}.env`)
            }
        });

        for (const key of Object.keys(envConfig)) {
            if (!envConfig[key]) {
                return Promise.reject(new Error(`envConfig missing required value for: ${key}`));
            }
        }

        // Ensure the storage directory exists for the Z-Wave network cache,
        // generated security keys, and rooms/scenes persistence
        await fse.ensureDir(envConfig.zwaveStorage);

        server.decorate(PluginName, {
            env: envConfig
        });
    }
    catch (ex) {
        server.log.error({ tags: [PluginName] }, `registering failed: ${exMessage(ex)}`);

        return Promise.reject(ex instanceof Error ? ex : new Error(exMessage(ex)));
    }
};

declare module 'fastify' {
    interface FastifyInstance {
        [PluginName]: IZWaveConfig;
    }
}

export default fp(configPlugin, {
    fastify: '5.x',
    name: PluginName
});
