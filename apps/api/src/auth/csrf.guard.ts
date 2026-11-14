import { Injectable, ForbiddenException } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const csrfCookie = request.cookies?.csrf_token;
    const csrfHeader = request.headers['x-csrf-token'];

    if (!csrfCookie || !csrfHeader) {
      throw new ForbiddenException('CSRF token missing');
    }

    const [rawToken, signature] = csrfCookie.split('.');
    if (!rawToken || !signature) {
      throw new ForbiddenException('Invalid CSRF cookie format');
    }

    const csrfSecret = process.env.CSRF_SECRET;
    if (!csrfSecret) {
      throw new Error('CSRF_SECRET environment variable is required');
    }

    const expectedSignature = crypto
      .createHmac('sha256', csrfSecret)
      .update(rawToken)
      .digest('base64url');

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException('Invalid CSRF token signature');
    }

    const rawBuffer = Buffer.from(rawToken);
    const headerBuffer = Buffer.from(csrfHeader);
    if (
      rawBuffer.length !== headerBuffer.length ||
      !crypto.timingSafeEqual(rawBuffer, headerBuffer)
    ) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    return true;
  }
}
