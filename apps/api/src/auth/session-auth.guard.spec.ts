import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';
import { AuthService } from './auth.service';

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;
  let authService: { validateSession: jest.Mock };
  let mockContext: any;
  let mockRequest: any;

  beforeEach(async () => {
    authService = { validateSession: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SessionAuthGuard,
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    guard = module.get(SessionAuthGuard);

    mockRequest = { cookies: {} };
    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    };
  });

  it('throws UnauthorizedException when no session token cookie', async () => {
    mockRequest.cookies = {};

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when session is invalid', async () => {
    mockRequest.cookies = { session_token: 'valid-token' };
    authService.validateSession.mockResolvedValue(null);

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches user to request and returns true when session is valid', async () => {
    mockRequest.cookies = { session_token: 'valid-token' };
    const session = {
      userId: 'user-1',
      email: 'test@test.com',
      role: 'passenger',
      sessionId: 'session-1',
    };
    authService.validateSession.mockResolvedValue(session);

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(mockRequest.user).toEqual(session);
  });
});
