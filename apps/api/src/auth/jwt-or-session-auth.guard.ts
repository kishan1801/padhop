import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionAuthGuard } from './session-auth.guard';

@Injectable()
export class JwtOrSessionAuthGuard implements CanActivate {
  constructor(
    private jwtAuthGuard: JwtAuthGuard,
    private sessionAuthGuard: SessionAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await this.jwtAuthGuard.canActivate(context);
      return true;
    } catch {
      // JWT failed, try session
    }

    try {
      await this.sessionAuthGuard.canActivate(context);
      return true;
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
  }
}
