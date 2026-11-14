import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { CsrfGuard } from './csrf.guard';
import { OriginGuard } from './origin.guard';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string; sessionId: string };
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  async signup(
    @Body() body: { name: string; email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.signup(body.name, body.email, body.password, res);
  }

  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(body.email, body.password, res);
  }

  @Get('csrf')
  async csrf(@Res({ passthrough: true }) res: Response) {
    this.authService.setCsrfCookieOnly(res);
    return { ok: true };
  }

  @UseGuards(SessionAuthGuard)
  @Get('me')
  async me(@Req() req: AuthenticatedRequest) {
    return this.authService.getMe(req.user.userId);
  }

  @UseGuards(SessionAuthGuard, CsrfGuard, OriginGuard)
  @Post('logout')
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(req.user.sessionId, res);
  }
}
