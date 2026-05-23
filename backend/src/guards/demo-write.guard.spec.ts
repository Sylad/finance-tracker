import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { DemoWriteGuard } from './demo-write.guard';

const ctx = (method: string, path: string): ExecutionContext => ({
  switchToHttp: () => ({
    getRequest: () => ({ method, path }),
  }),
} as unknown as ExecutionContext);

describe('DemoWriteGuard', () => {
  it('allows reads on forced demo hosts', () => {
    const guard = new DemoWriteGuard({ isForced: () => true } as any);
    expect(guard.canActivate(ctx('GET', '/api/statements'))).toBe(true);
  });

  it('allows demo seed bootstrap on forced demo hosts', () => {
    const guard = new DemoWriteGuard({ isForced: () => true } as any);
    expect(guard.canActivate(ctx('POST', '/api/demo/seed'))).toBe(true);
  });

  it('blocks non-seed writes on forced demo hosts', () => {
    const guard = new DemoWriteGuard({ isForced: () => true } as any);
    expect(() => guard.canActivate(ctx('POST', '/api/analysis/upload'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('PATCH', '/api/statements/2026-03/transactions/t1/category'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('DELETE', '/api/demo/data'))).toThrow(ForbiddenException);
  });

  it('does not block writes outside forced demo mode', () => {
    const guard = new DemoWriteGuard({ isForced: () => false } as any);
    expect(guard.canActivate(ctx('POST', '/api/analysis/upload'))).toBe(true);
  });
});
