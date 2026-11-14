import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';
import * as crypto from 'crypto';

process.env.CSRF_SECRET =
  'dGVzdF9jc3JmX3NlY3JldF9mb3JfZGV2ZWxvcG1lbnRfb25seQ==';

describe('CsrfGuard', () => {
  let guard: CsrfGuard;
  let mockContext: any;
  let mockRequest: any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CsrfGuard],
    }).compile();

    guard = module.get(CsrfGuard);

    mockRequest = { method: 'POST', cookies: {}, headers: {} };
    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    };
  });

  it('allows GET requests without CSRF', async () => {
    mockRequest.method = 'GET';

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
  });

  it('allows HEAD requests without CSRF', async () => {
    mockRequest.method = 'HEAD';

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
  });

  it('allows OPTIONS requests without CSRF', async () => {
    mockRequest.method = 'OPTIONS';

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
  });

  it('throws ForbiddenException when CSRF cookie is missing', () => {
    mockRequest.method = 'POST';
    mockRequest.cookies = {};
    mockRequest.headers = {};

    expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when CSRF header is missing', () => {
    mockRequest.method = 'POST';
    mockRequest.cookies = { csrf_token: 'raw.signature' };
    mockRequest.headers = {};

    expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when CSRF cookie format is invalid', () => {
    mockRequest.method = 'POST';
    mockRequest.cookies = { csrf_token: 'invalid-format' };
    mockRequest.headers = { 'x-csrf-token': 'raw' };

    expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when CSRF signature is invalid', () => {
    mockRequest.method = 'POST';
    mockRequest.cookies = { csrf_token: 'raw.invalid' };
    mockRequest.headers = { 'x-csrf-token': 'raw' };

    expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when CSRF token does not match header', () => {
    mockRequest.method = 'POST';
    const rawToken = 'raw-token';
    const signature = crypto
      .createHmac('sha256', process.env.CSRF_SECRET!)
      .update(rawToken)
      .digest('base64url');
    mockRequest.cookies = { csrf_token: `${rawToken}.${signature}` };
    mockRequest.headers = { 'x-csrf-token': 'different-token' };

    expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
  });

  it('returns true when CSRF token is valid', async () => {
    mockRequest.method = 'POST';
    const rawToken = 'valid-csrf-token';
    const signature = crypto
      .createHmac('sha256', process.env.CSRF_SECRET!)
      .update(rawToken)
      .digest('base64url');
    mockRequest.cookies = { csrf_token: `${rawToken}.${signature}` };
    mockRequest.headers = { 'x-csrf-token': rawToken };

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
  });
});
