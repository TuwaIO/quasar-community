import { collectDefaultMetrics, Counter, register } from 'prom-client';

const globalRef = global as unknown as {
  prometheusInitialized?: boolean;
  httpRequestsTotal?: Counter;
  authAttemptsTotal?: Counter;
};

if (!globalRef.prometheusInitialized) {
  // Prefix default metrics to differentiate from NestJS metrics
  collectDefaultMetrics({ register, prefix: 'quasar_app_' });

  globalRef.httpRequestsTotal = new Counter({
    name: 'quasar_dashboard_http_requests_total',
    help: 'Total number of HTTP requests processed by the dashboard',
    labelNames: ['method', 'status'],
  });

  globalRef.authAttemptsTotal = new Counter({
    name: 'quasar_dashboard_auth_attempts_total',
    help: 'Total number of authentication attempts in the dashboard',
    labelNames: ['status'], // success, failure
  });

  globalRef.prometheusInitialized = true;
}

export const httpRequestsTotal = globalRef.httpRequestsTotal;
export const authAttemptsTotal = globalRef.authAttemptsTotal;
export { register };
