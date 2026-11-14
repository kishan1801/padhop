import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtOrSessionAuthGuard } from './jwt-or-session-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionAuthGuard } from './session-auth.guard';

describe('JwtOrSessionAuthGuard', () => {
  let guard: JwtOrSessionAuthGuard;
  let jwtAuthGuard: { canActivate: jest.Mock };
  let sessionAuthGuard: { canActivate: jest.Mock };
  let mockContext: any;

  beforeEach(async () => {
    jwtAuthGuard = { canActivate: jest.fn() };
    sessionAuthGuard = { canActivate: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        JwtOrSessionAuthGuard,
        { provide: JwtAuthGuard, useValue: jwtAuthGuard },
        { provide: SessionAuthGuard, useValue: sessionAuthGuard },
      ],
    }).compile();

    guard = module.get(JwtOrSessionAuthGuard);

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    };
  });

  it('returns true when JWT authentication succeeds', async () => {
    jwtAuthGuard.canActivate.mockResolvedValue(true);

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(mockContext);
    expect(sessionAuthGuard.canActivate).not.toHaveBeenCalled();
  });

  it('tries session authentication when JWT fails', async () => {
    jwtAuthGuard.canActivate.mockRejectedValue(new UnauthorizedException());
    sessionAuthGuard.canActivate.mockResolvedValue(true);

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(mockContext);
    expect(sessionAuthGuard.canActivate).toHaveBeenCalledWith(mockContext);
  });

  it('throws UnauthorizedException when both JWT and session fail', async () => {
    jwtAuthGuard.canActivate.mockRejectedValue(new UnauthorizedException());
    sessionAuthGuard.canActivate.mockRejectedValue(new UnauthorizedException());

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(mockContext);
    expect(sessionAuthGuard.canActivate).toHaveBeenCalledWith(mockContext);
  });
});
