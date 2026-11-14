import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const SESSION_EXPIRY_DAYS = 7;
const SESSION_TOKEN_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signup(name: string, email: string, password: string, res: Response) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: { name, email, passwordHash },
    });

    await this.createSessionAndSetCookies(user.id, res);
    return { user: this.toUserProfile(user) };
  }

  async login(email: string, password: string, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.createSessionAndSetCookies(user.id, res);
    return { user: this.toUserProfile(user) };
  }

  async logout(sessionId: string, res: Response) {
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    this.clearSessionCookies(res);
    return { ok: true };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return { user: this.toUserProfile(user) };
  }

  async validateSession(tokenHash: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
    });

    if (!session) {
      return null;
    }

    if (session.revokedAt) {
      return null;
    }

    if (session.expiresAt < new Date()) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      return null;
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return {
      userId: session.userId,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    };
  }

  async validateJwtPayload(payload: { sub: string; email: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      return null;
    }
    return { userId: user.id, email: user.email, role: user.role };
  }

  private async createSessionAndSetCookies(userId: string, res: Response) {
    const rawToken = this.generateSessionToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.session.create({
      data: { userId, tokenHash, expiresAt },
    });

    this.setSessionCookie(res, rawToken, expiresAt);
    this.setCsrfCookie(res, expiresAt);
  }

  private generateSessionToken(): string {
    return crypto.randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private setSessionCookie(res: Response, token: string, expiresAt: Date) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private setCsrfCookie(res: Response, expiresAt: Date) {
    const isProduction = process.env.NODE_ENV === 'production';
    const rawCsrf = crypto.randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
    const csrfSecret = process.env.CSRF_SECRET;
    if (!csrfSecret) {
      throw new Error('CSRF_SECRET environment variable is required');
    }
    const signature = crypto
      .createHmac('sha256', csrfSecret)
      .update(rawCsrf)
      .digest('base64url');
    const csrfToken = `${rawCsrf}.${signature}`;
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private clearSessionCookies(res: Response) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('session_token', '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    res.cookie('csrf_token', '', {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }

  setCsrfCookieOnly(res: Response) {
    const isProduction = process.env.NODE_ENV === 'production';
    const rawCsrf = crypto.randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
    const csrfSecret = process.env.CSRF_SECRET;
    if (!csrfSecret) {
      throw new Error('CSRF_SECRET environment variable is required');
    }
    const signature = crypto
      .createHmac('sha256', csrfSecret)
      .update(rawCsrf)
      .digest('base64url');
    const csrfToken = `${rawCsrf}.${signature}`;
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private toUserProfile(user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  private buildToken(userId: string, email: string) {
    const payload = { sub: userId, email };
    return { accessToken: this.jwtService.sign(payload) };
  }
}
