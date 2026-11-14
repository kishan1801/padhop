import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service';
import * as crypto from 'crypto';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const sessionToken = request.cookies?.session_token;

    if (!sessionToken) {
      throw new UnauthorizedException('No session token');
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(sessionToken)
      .digest('hex');
    const session = await this.authService.validateSession(tokenHash);

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    request.user = session;
    return true;
  }
}
