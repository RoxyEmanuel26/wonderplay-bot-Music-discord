import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // The codebase consistently logs caught exceptions under `error`. Without a
  // serializer, native Error properties are non-enumerable and production logs
  // only show `error: {}`, hiding the actual cause and stack trace.
  serializers: {
    error: pino.stdSerializers.err,
    err: pino.stdSerializers.err,
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});
