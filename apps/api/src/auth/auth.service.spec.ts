import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
    };
    jwtService = { sign: jest.fn().mockReturnValue('fake-jwt-token') };

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
        service.signup('Name', 'taken@padhop.test', 'password123'),
      ).rejects.toThrow(ConflictException);
    });

    it('stores a bcrypt hash, never the plain-text password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-user', email: 'new@padhop.test' });

      await service.signup('Name', 'new@padhop.test', 'plaintext-password');

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.passwordHash).not.toBe('plaintext-password');
      expect(await bcrypt.compare('plaintext-password', createArgs.data.passwordHash)).toBe(true);
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException if the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('nobody@padhop.test', 'password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException if the password is wrong', async () => {
      const realHash = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@padhop.test',
        passwordHash: realHash,
      });

      await expect(
        service.login('user@padhop.test', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns a token when credentials are correct', async () => {
      const realHash = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@padhop.test',
        passwordHash: realHash,
      });

      const result = await service.login('user@padhop.test', 'correct-password');

      expect(result.accessToken).toBe('fake-jwt-token');
    });
  });
});