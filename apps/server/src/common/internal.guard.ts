import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TUWA_HEADERS } from '@tuwaio/shared/constants';

import { IS_INTERNAL_ONLY_KEY } from './internal.decorator';
import { SecretRotationService } from './secret-rotation.service';

@Injectable()
export class InternalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly secretRotationService: SecretRotationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isInternalOnly = this.reflector.getAllAndOverride<boolean>(IS_INTERNAL_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isInternalOnly) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const path = request.url?.split('?')[0];

    // Protect metrics endpoint from external access
    if (path === '/metrics' || path === '/metrics/') {
      if (request.headers['x-forwarded-for'] || request.headers['x-real-ip']) {
        throw new UnauthorizedException('Metrics endpoint is internal only');
      }
      return true;
    }

    const incomingSecret =
      request.headers[TUWA_HEADERS.INTERNAL_SECRET.toLowerCase()] || request.headers[TUWA_HEADERS.INTERNAL_SECRET];

    if (!incomingSecret || typeof incomingSecret !== 'string') {
      throw new UnauthorizedException('Missing x-internal-secret header');
    }

    // Validate using constant-time check, bounded overlap, and emergency revocation
    const isValid = await this.secretRotationService.validateSecret(incomingSecret);

    if (!isValid) {
      throw new UnauthorizedException('Invalid x-internal-secret header');
    }

    return true;
  }
}
