import { FastifyReply, FastifyRequest, FastifyServerOptions, LogController } from 'fastify';

type LoggerOptions = Exclude<NonNullable<FastifyServerOptions['logger']>, boolean>;

// The log is read by a person (`docker logs`, Portainer), so the default is one
// readable line per entry: time, level, [tags] and the message. `LOG_FORMAT=json`
// keeps one JSON object per line for a collector that parses it.
//
// This used to depend on NODE_ENV, which meant the image -- the only place the
// service actually runs -- was the one place the log was unreadable.
//
// Tags arrive in two spellings, `log.info({ tags: ['Name'] }, …)` and
// `log.info(['Name'], …)`. Both end up in the `tags` field as "[Name]".
export function loggerOptions(): LoggerOptions {
    const options: LoggerOptions = {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['req.headers.authorization'],
        formatters: {
            log(entry) {
                return Array.isArray(entry) ? { tags: entry } : entry;
            }
        },
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
            tags: (tags: unknown) => {
                return Array.isArray(tags) ? `[${tags.join(',')}]` : '[]';
            }
        }
    };

    if (process.env.LOG_FORMAT === 'json') {
        return options;
    }

    return {
        ...options,
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                singleLine: true,
                messageFormat: '{if tags}{tags} {end}{msg}',
                translateTime: 'SYS:yyyy-mm-dd"T"HH:MM:sso',
                ignore: 'pid,hostname,tags,req,res,reqId,responseTime'
            }
        }
    };
}

const ModuleName = 'Http';

// Fastify logs two lines per request, "incoming request" and "request completed".
// The web client polls five endpoints every 5s, so that pair was most of the log and
// none of it was about this controller -- and every router already logs its own
// tagged line saying what it is doing.
//
// Overriding the controller rather than setting `disableRequestLogging` is deliberate:
// that option is deprecated in Fastify 5 and removed in 6, and it silences
// `defaultErrorLog` too, so a 500 would lose its stack trace. Left alone here, an
// exception still logs in full; only the per-request pair is replaced, by one warn
// line for a request that actually failed.
export class QuietRequestLogController extends LogController {
    public incomingRequest(): void {
        // Deliberately silent: the router's own line covers the happy path.
    }

    public requestCompleted(error: Error | null, request: FastifyRequest, reply: FastifyReply): void {
        // Fastify's type says `Error | null`, but a successful request passes
        // `undefined` -- `error === null` logged every 200 at warn level.
        if (!error && reply.statusCode < 400) {
            return;
        }

        request.log.warn(
            { tags: [ModuleName] },
            `${request.method} ${request.url} -> ${reply.statusCode} (${reply.elapsedTime.toFixed(1)}ms)`
        );
    }
}
