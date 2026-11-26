import { z } from 'zod';

export const veniceConfigSchema = z.object({
  VENICE_API_KEY: z.string().min(1, 'VENICE_API_KEY is required'),
  VENICE_BASE_URL: z
    .string()
    .url('VENICE_BASE_URL must be a valid URL')
    .default('https://api.venice.ai/api/v1'),
  VENICE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  VENICE_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(5),
  VENICE_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  VENICE_CIRCUIT_RECOVERY_WINDOW_MS: z.coerce.number().int().positive().default(30_000),
  VENICE_CIRCUIT_FAILURE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export type VeniceConfig = z.infer<typeof veniceConfigSchema>;

/**
 * Parse and validate Venice AI configuration from environment variables.
 * Throws a ZodError with descriptive messages if required variables are
 * missing or malformed.
 */
export function parseVeniceConfig(env: NodeJS.ProcessEnv = process.env): VeniceConfig {
  return veniceConfigSchema.parse({
    VENICE_API_KEY: env.VENICE_API_KEY,
    VENICE_BASE_URL: env.VENICE_BASE_URL,
    VENICE_REQUEST_TIMEOUT_MS: env.VENICE_REQUEST_TIMEOUT_MS,
    VENICE_PROVIDER_MAX_RETRIES: env.VENICE_PROVIDER_MAX_RETRIES,
    VENICE_CIRCUIT_FAILURE_THRESHOLD: env.VENICE_CIRCUIT_FAILURE_THRESHOLD,
    VENICE_CIRCUIT_RECOVERY_WINDOW_MS: env.VENICE_CIRCUIT_RECOVERY_WINDOW_MS,
    VENICE_CIRCUIT_FAILURE_WINDOW_MS: env.VENICE_CIRCUIT_FAILURE_WINDOW_MS,
  });
}
