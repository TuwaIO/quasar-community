import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram } from 'prom-client';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class PrometheusInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric('http_request_duration_seconds')
    private readonly histogram: Histogram<string>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const { method, route } = request;

    // Use route path if available, otherwise fallback to 'unknown' to avoid URL cardinality explosion
    const path = route?.path || 'unknown';

    const stopTimer = this.histogram.startTimer({
      method,
      route: path,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const response = http.getResponse();
          stopTimer({ status: response.statusCode });
        },
        error: (err) => {
          const status = err.status || 500;
          stopTimer({ status });
        },
      }),
    );
  }
}
