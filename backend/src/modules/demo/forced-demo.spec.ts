import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isForcedDemoRequest } from './forced-demo';
import { DemoModeMiddleware } from './demo-mode.middleware';
import { PinGuard } from '../../guards/pin.guard';

const HOSTS = ['trycloudflare.com', 'finance.sladoire.dev'];

const req = (headers: Record<string, string>, path = '/api/statements') =>
  ({
    path,
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  }) as any;

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('isForcedDemoRequest', () => {
  it('forces demo when the Host matches a forced pattern', () => {
    expect(isForcedDemoRequest(req({ host: 'finance.sladoire.dev' }), HOSTS, false)).toBe(true);
    expect(isForcedDemoRequest(req({ host: 'abc.TRYCLOUDFLARE.com' }), HOSTS, false)).toBe(true);
  });

  it('ignores X-Forwarded-Host: a client cannot leave demo by forging it', () => {
    const r = req({ host: 'finance.sladoire.dev', 'x-forwarded-host': 'example.com' });
    expect(isForcedDemoRequest(r, HOSTS, false)).toBe(true);
  });

  it('ignores X-Forwarded-Host: a client cannot enter forced demo (PIN bypass) by forging it', () => {
    const r = req({ host: 'localhost:3000', 'x-forwarded-host': 'x.trycloudflare.com' });
    expect(isForcedDemoRequest(r, HOSTS, false)).toBe(false);
  });

  it('forces demo for every request when the instance is forced server-side', () => {
    expect(isForcedDemoRequest(req({ host: 'finance.dark-blue.lan' }), HOSTS, true)).toBe(true);
    expect(isForcedDemoRequest(req({}), [], true)).toBe(true);
  });

  it('matches the exact host or a dot-preceded suffix only, not a substring (L42)', () => {
    const TUNNEL = ['trycloudflare.com'];
    expect(isForcedDemoRequest(req({ host: 'evil-trycloudflare.com' }), TUNNEL, false)).toBe(false);
    expect(isForcedDemoRequest(req({ host: 'trycloudflare.com.evil.net' }), TUNNEL, false)).toBe(false);
    expect(isForcedDemoRequest(req({ host: 'finance.sladoire.dev.evil.net' }), HOSTS, false)).toBe(false);
    expect(isForcedDemoRequest(req({ host: 'x.trycloudflare.com:443' }), TUNNEL, false)).toBe(true);
    expect(isForcedDemoRequest(req({ host: 'trycloudflare.com' }), TUNNEL, false)).toBe(true);
  });

  it('normalises port, trailing dot and case on both sides (L42)', () => {
    expect(isForcedDemoRequest(req({ host: 'X.TryCloudflare.COM.' }), ['trycloudflare.com'], false)).toBe(true);
    expect(isForcedDemoRequest(req({ host: 'x.trycloudflare.com.:8443' }), ['trycloudflare.com'], false)).toBe(true);
    expect(isForcedDemoRequest(req({ host: 'a.trycloudflare.com' }), [' TryCloudflare.com. '], false)).toBe(true);
    expect(isForcedDemoRequest(req({ host: 'mytrycloudflare.com:443' }), ['trycloudflare.com'], false)).toBe(false);
    expect(isForcedDemoRequest(req({ host: '[::1]:3000' }), ['::1'], false)).toBe(false);
  });

  it('accepts a pattern written with a leading dot (L42)', () => {
    expect(isForcedDemoRequest(req({ host: 'x.trycloudflare.com' }), ['.trycloudflare.com'], false)).toBe(true);
    expect(isForcedDemoRequest(req({ host: 'evil-trycloudflare.com' }), ['.trycloudflare.com'], false)).toBe(false);
  });

  it('is not forced without a Host and without the server-side flag', () => {
    expect(isForcedDemoRequest(req({}), HOSTS, false)).toBe(false);
    expect(isForcedDemoRequest(req({ host: 'x' }), ['', ' ', '.'], false)).toBe(false);
  });
});

describe('DemoModeMiddleware — forced detection', () => {
  const run = (headers: Record<string, string>, values: Record<string, unknown> = {}) => {
    let captured: { demoMode: boolean; forced: boolean } | undefined;
    const dataDir = { runWith: (ctx: any, fn: () => void) => { captured = ctx; fn(); } } as any;
    const mw = new DemoModeMiddleware(dataDir, config({ demoForcedHosts: HOSTS, ...values }));
    mw.use(req(headers), {} as any, () => undefined);
    return captured!;
  };

  it('stays forced when a public visitor forges X-Forwarded-Host', () => {
    expect(run({ host: 'finance.sladoire.dev', 'x-forwarded-host': 'example.com' }))
      .toEqual({ demoMode: true, forced: true });
  });

  it('local instance: real data by default, demo only via X-Demo-Mode', () => {
    expect(run({ host: 'localhost:3000' })).toEqual({ demoMode: false, forced: false });
    expect(run({ host: 'localhost:3000', 'x-demo-mode': 'true' })).toEqual({ demoMode: true, forced: false });
  });

  it('honours the server-side DEMO_FORCED flag', () => {
    expect(run({ host: 'finance.dark-blue.lan' }, { demoForcedAll: true }))
      .toEqual({ demoMode: true, forced: true });
  });
});

describe('PinGuard — forced demo bypass', () => {
  const ctx = (r: any): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => r }) }) as unknown as ExecutionContext;
  const guard = (values: Record<string, unknown> = {}) =>
    new PinGuard(config({ appPin: '1234', demoForcedHosts: HOSTS, ...values }));

  it('does not bypass the PIN on a forged X-Forwarded-Host', () => {
    const r = req({ host: 'localhost:3000', 'x-forwarded-host': 'x.trycloudflare.com' });
    expect(() => guard().canActivate(ctx(r))).toThrow(UnauthorizedException);
  });

  it('bypasses the PIN when the Host is a forced demo host', () => {
    expect(guard().canActivate(ctx(req({ host: 'finance.sladoire.dev' })))).toBe(true);
  });

  it('bypasses the PIN when the instance is forced server-side', () => {
    expect(guard({ demoForcedAll: true }).canActivate(ctx(req({ host: 'finance.dark-blue.lan' })))).toBe(true);
  });

  it('still accepts the right PIN on the local instance', () => {
    const r = req({ host: 'localhost:3000', authorization: 'Bearer 1234' });
    expect(guard().canActivate(ctx(r))).toBe(true);
  });
});
