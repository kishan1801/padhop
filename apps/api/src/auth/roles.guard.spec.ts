import { Test } from '@nestjs/testing';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { PrismaService } from '../prisma/prisma.service';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };

    const module = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: reflector },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(RolesGuard);
  });

  function mockContext(userId: string): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId } }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows the request through if no @Roles() decorator is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(mockContext('user-1'));

    expect(result).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows the request through if the user has the required role', async () => {
    reflector.getAllAndOverride.mockReturnValue(['operator']);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'operator' });

    const result = await guard.canActivate(mockContext('user-1'));

    expect(result).toBe(true);
  });

  it('throws ForbiddenException if the user does not have the required role', async () => {
    reflector.getAllAndOverride.mockReturnValue(['operator']);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'passenger' });

    await expect(guard.canActivate(mockContext('user-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException if the user does not exist', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(mockContext('ghost-user'))).rejects.toThrow(
      ForbiddenException,
    );
  });
});