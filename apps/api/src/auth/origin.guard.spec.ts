import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { OriginGuard } from './origin.guard';

process.env.FRONTEND_ORIGIN = 'http://localhost:3001';

describe('OriginGuard', () => {
  let guard: OriginGuard;
  let mockContext: any;
  let mockRequest: any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OriginGuard],
    }).compile();

    guard = module.get(OriginGuard);

    mockRequest = { method: 'POST', headers: {} };
    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    };
  });

  it('allows GET requests without Origin', async () => {
    mockRequest.method = 'GET';

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
  });

  it('allows HEAD requests without Origin', async () => {
    mockRequest.method = 'HEAD';

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
  });

  it('allows OPTIONS requests without Origin', async () => {
    mockRequest.method = 'OPTIONS';

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
  });

  it('throws ForbiddenException when Origin header is missing', () => {
    mockRequest.method = 'POST';
    mockRequest.headers = {};

    expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when Origin does not match', () => {
    mockRequest.method = 'POST';
    mockRequest.headers = { origin: 'http://evil.com' };

    expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
  });

  it('returns true when Origin matches', async () => {
    mockRequest.method = 'POST';
    mockRequest.headers = { origin: 'http://localhost:3001' };

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
  });
});
