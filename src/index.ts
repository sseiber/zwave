/* eslint-disable no-console */
import { FastifyInstance } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import composeServer from './composeServer.js';
import { exMessage } from './utils/index.js';

const ModuleName = 'Main';

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});

async function start() {
    const loggerConfig = process.env.NODE_ENV === 'production'
        ? true
        : {
            redact: ['req.headers.authorization'],
            level: 'info',
            serializers: {
                req(req) {
                    return {
                        method: req.method,
                        url: req.url,
                        protocol: req.protocol,
                        headers: {
                            host: req.headers.host,
                            'user-agent': req.headers['user-agent']
                        }
                    };
                },
                tags: (tags: string[]) => {
                    return Array.isArray(tags) ? `[${tags.join(',')}]` : '[]';
                }
            },
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    singleLine: true,
                    messageFormat: '{tags} {msg} {if req.url}url:({req.protocol}://{req.headers.host}{req.url}) {end}{res.statusCode} {responseTime}',
                    translateTime: 'SYS:yyyy-mm-dd"T"HH:MM:sso',
                    ignore: 'pid,hostname,module,tags,data,msg,req,res,reqId,responseTime'
                }
            }
        };

    try {
        const server: FastifyInstance<Server, IncomingMessage, ServerResponse> = await composeServer({
            logger: loggerConfig,
            pluginTimeout: 60000
        });

        server.log.info({ tags: [ModuleName] }, `🚀 Server instance started`);

        const PORT = (server.config.env.PORT ?? process.env.PORT ?? process.env.port);
        if (!PORT) {
            throw new Error('PORT is not defined');
        }

        await server.listen({
            host: '0.0.0.0',
            port: parseInt(PORT, 10)
        });

        for (const signal of ['SIGINT', 'SIGTERM']) {
            process.on(signal, () => {
                console.log(`Closing server instance with ${signal}`);
                server.close().then((error) => {
                    process.exit(error ? 1 : 0);
                }).catch((ex) => {
                    console.error(`Error closing server instance: ${exMessage(ex)}`);
                    process.exit(1);
                });
            });
        }
    }
    catch (ex) {
        console.error(`Error ${ModuleName}: ${exMessage(ex)}`);
        console.info(`Error ${ModuleName}: ☮︎ Stopping server`);

        process.exit(1);
    }
}

void (async () => {
    await start();
})().catch();
