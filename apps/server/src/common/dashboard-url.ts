import type { ConfigService } from '@nestjs/config';

/**
 * Where the engine reaches the dashboard for its internal routes (`/api/internal/...`): inside the Docker network when
 * `DASHBOARD_INTERNAL_URL` is set, else the public `NEXT_PUBLIC_SERVER_URL`. The public URL can sit behind the password
 * of the reverse proxy, as on staging, and otherwise goes out through the CDN and back.
 *
 * @param config - The configuration of the engine.
 */
export function dashboardUrl(config: ConfigService): string | undefined {
  return config.get<string>('DASHBOARD_INTERNAL_URL') || config.get<string>('NEXT_PUBLIC_SERVER_URL') || undefined;
}
