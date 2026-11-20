/**
 * hotReload.ts — wires the ConfigService subscriber to a Redis connection.
 *
 * Call `initHotReload()` once during server startup, after the Redis URL is
 * known, to enable cross-instance config propagation via the config:updates
 * pub/sub channel.
 */

import Redis from 'ioredis';
import { getConfigService, CONFIG_REDIS_CHANNEL } from './configService';
import { createLogger } from '../utils/logger';

const logger = createLogger({ module: 'hotReload' });

let subscriber: Redis | undefined;
let publisher: Redis | undefined;

export function initHotReload(redisUrl: string): { publisher: Redis; subscriber: Redis } {
  if (subscriber && publisher) {
    return { publisher, subscriber };
  }

  const retryStrategy = (attempt: number) => Math.min(attempt * 200, 10_000);

  publisher = new Redis(redisUrl, { retryStrategy, lazyConnect: true });
  subscriber = new Redis(redisUrl, { retryStrategy, lazyConnect: true });

  publisher.on('error', err =>
    logger.warn({ err }, 'config hot-reload: Redis publisher error'),
  );
  subscriber.on('error', err =>
    logger.warn({ err }, 'config hot-reload: Redis subscriber error'),
  );

  subscriber.on('ready', () =>
    logger.info({ channel: CONFIG_REDIS_CHANNEL }, 'config hot-reload: Redis subscriber ready'),
  );

  getConfigService().subscribe(subscriber);

  logger.info({ redisUrl: redisUrl.replace(/\/\/.*@/, '//***@') }, 'config hot-reload initialised');

  return { publisher, subscriber };
}

export function getHotReloadPublisher(): Redis | undefined {
  return publisher;
}

export function disconnectHotReload(): void {
  publisher?.disconnect();
  subscriber?.disconnect();
  publisher = undefined;
  subscriber = undefined;
}
