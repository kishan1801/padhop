import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';

process.env.CSRF_SECRET =
  'dGVzdF9jc3JmX3NlY3JldF9mb3JfZGV2ZWxvcG1lbnRfb25seQ==';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    operator: { findUnique: jest.Mock };
    session: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwtService: { sign: jest.Mock };
  let mockResponse: Partial<Response>;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      operator: { findUnique: jest.fn().mockResolvedValue(null) },
      session: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jwtService = { sign: jest.fn().mockReturnValue('fake-jwt-token') };
    mockResponse = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('signup', () => {
    it('throws ConflictException if the email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.signup(
          'Name',
          'taken@padhop.test',
          'password123',
          mockResponse as Response,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('stores a bcrypt hash, never the plain-text password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'new-user',
        email: 'new@padhop.test',
        name: 'Name',
        role: 'passenger',
      });
      prisma.session.create.mockResolvedValue({});

      await service.signup(
        'Name',
        'new@padhop.test',
        'plaintext-password',
        mockResponse as Response,
      );

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.passwordHash).not.toBe('plaintext-password');
      expect(
        await bcrypt.compare(
          'plaintext-password',
          createArgs.data.passwordHash,
        ),
      ).toBe(true);
      expect(prisma.session.create).toHaveBeenCalled();
      expect(mockResponse.cookie).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException if the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login(
          'nobody@padhop.test',
          'password',
          mockResponse as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if the password is wrong', async () => {
      const realHash = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@padhop.test',
        passwordHash: realHash,
      });

      await expect(
        service.login(
          'user@padhop.test',
          'wrong-password',
          mockResponse as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns a user when credentials are correct', async () => {
      const realHash = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@padhop.test',
        passwordHash: realHash,
        name: 'Test User',
        role: 'passenger',
      });
      prisma.session.create.mockResolvedValue({});

      const result = await service.login(
        'user@padhop.test',
        'correct-password',
        mockResponse as Response,
      );

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'user@padhop.test',
        name: 'Test User',
        role: 'passenger',
        hasOperatorProfile: false,
        isVerified: false,
      });
      expect(prisma.session.create).toHaveBeenCalled();
      expect(mockResponse.cookie).toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    it('reports no operator profile for a user without an Operator record', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@padhop.test',
        name: 'Test User',
        role: 'passenger',
      });
      prisma.operator.findUnique.mockResolvedValue(null);

      const result = await service.getMe('user-1');

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'user@padhop.test',
        name: 'Test User',
        role: 'passenger',
        hasOperatorProfile: false,
        isVerified: false,
      });
    });

    it('reports a verified operator from the Operator record, not the role', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'operator-user',
        email: 'operator@padhop.test',
        name: 'Operator',
        role: 'operator',
      });
      prisma.operator.findUnique.mockResolvedValue({ verified: true });

      const result = await service.getMe('operator-user');

      expect(result.user.hasOperatorProfile).toBe(true);
      expect(result.user.isVerified).toBe(true);
    });

    it('reports a pending operator when the Operator record is unverified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'operator-user',
        email: 'operator@padhop.test',
        name: 'Operator',
        role: 'operator',
      });
      prisma.operator.findUnique.mockResolvedValue({ verified: false });

      const result = await service.getMe('operator-user');

      expect(result.user.hasOperatorProfile).toBe(true);
      expect(result.user.isVerified).toBe(false);
    });
  });
});
