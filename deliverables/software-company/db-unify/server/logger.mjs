/**
 * 统一日志系统（基于 winston）
 * 支持控制台 + 文件输出，带 traceId 追踪
 */
import winston from 'winston';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// TraceId 追踪（每个请求一个 ID）
const asyncLocalStorage = new AsyncLocalStorage();

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.printf(({ timestamp, level, message, traceId, ...meta }) => {
          const tid = traceId || '';
          const prefix = tid ? `[${tid}]` : '';
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level.toUpperCase()} ${prefix} ${message}${metaStr}`;
        })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

/**
 * 为当前异步上下文设置 traceId
 */
export function runWithTrace(traceId, callback) {
  return asyncLocalStorage.run(traceId, callback);
}

/**
 * 获取当前请求的 traceId
 */
export function getTraceId() {
  return asyncLocalStorage.getStore() || '-';
}

/**
 * 带 traceId 的代理 logger
 */
export const log = {
  debug: (msg, meta) => logger.debug(msg, { traceId: getTraceId(), ...meta }),
  info: (msg, meta) => logger.info(msg, { traceId: getTraceId(), ...meta }),
  warn: (msg, meta) => logger.warn(msg, { traceId: getTraceId(), ...meta }),
  error: (msg, meta) => logger.error(msg, { traceId: getTraceId(), ...meta }),
};

export default logger;
