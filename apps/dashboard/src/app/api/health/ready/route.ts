import { NextResponse } from 'next/server';

/**
 * Shallow readiness probe for Docker healthcheck.
 *
 * Returns 200 OK if the Node.js process is alive and serving HTTP.
 * Does NOT check database or Redis connectivity — that's handled by
 * the deep health check at `/api/health`.
 *
 * Used by: Docker daemon healthcheck (container-level liveness).
 * The CI/CD deploy pipeline uses the deep `/api/health` for full readiness.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
