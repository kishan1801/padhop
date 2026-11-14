import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { CsrfGuard } from './csrf.guard';
import { OriginGuard } from './origin.guard';
import { JwtOrSessionAuthGuard } from './jwt-or-session-auth.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    SessionAuthGuard,
    CsrfGuard,
    OriginGuard,
    JwtOrSessionAuthGuard,
  ],
  exports: [
    JwtAuthGuard,
    SessionAuthGuard,
    CsrfGuard,
    OriginGuard,
    JwtOrSessionAuthGuard,
  ],
})
export class AuthModule {}
