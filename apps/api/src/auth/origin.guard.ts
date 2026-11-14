import { Injectable, ForbiddenException } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const origin = request.headers.origin;
    const allowedOrigin = process.env.FRONTEND_ORIGIN;

    if (!allowedOrigin) {
      throw new Error('FRONTEND_ORIGIN environment variable is required');
    }

    if (!origin) {
      throw new ForbiddenException('Origin header required');
    }

    if (origin !== allowedOrigin) {
      throw new ForbiddenException('Invalid origin');
    }

    return true;
  }
}
