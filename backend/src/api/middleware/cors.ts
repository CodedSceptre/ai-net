import cors from 'cors';
import { allowedOrigins } from '../../config';

export function createCorsMiddleware() {
  const origins = allowedOrigins();

  return cors({
    origin: (origin, callback) => {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    exposedHeaders: ['X-Request-ID'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'walletpublickey', 'x-challenge',
      'x-signature', 'Idempotency-Key', 'API-Version',
    ],
    exposedHeaders: ['Retry-After', 'X-API-Version', 'Deprecation', 'Sunset'],
    allowedHeaders: ['Content-Type', 'Authorization', 'walletpublickey', 'x-challenge', 'x-signature', 'X-Request-ID'],
  });
}
