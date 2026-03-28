import { describe, it, expect } from 'vitest';
import { getErrorGuidance, formatMessage } from './guidance';

describe('getErrorGuidance', () => {
  it('returns specific guidance for a known domain+code', () => {
    const g = getErrorGuidance('github', 'RATE_LIMITED');
    expect(g.template.title).toBe('GitHub rate limit reached');
    expect(g.template.retryable).toBe(true);
    expect(g.steps.length).toBeGreaterThan(0);
    expect(g.links.length).toBeGreaterThan(0);
  });

  it('returns specific guidance for vercel AUTH_FAILED', () => {
    const g = getErrorGuidance('vercel', 'AUTH_FAILED');
    expect(g.template.title).toBe('Vercel authentication failed');
    expect(g.template.retryable).toBe(false);
  });

  it('returns specific guidance for stripe CARD_DECLINED', () => {
    const g = getErrorGuidance('stripe', 'CARD_DECLINED');
    expect(g.template.retryable).toBe(true);
    expect(g.steps.length).toBeGreaterThanOrEqual(3);
  });

  it('returns specific guidance for stellar INSUFFICIENT_BALANCE', () => {
    const g = getErrorGuidance('stellar', 'INSUFFICIENT_BALANCE');
    expect(g.template.title).toBe('Insufficient XLM balance');
    expect(g.links.some((l) => l.url.includes('friendbot'))).toBe(true);
  });

  it('returns specific guidance for auth INVALID_CREDENTIALS', () => {
    const g = getErrorGuidance('auth', 'INVALID_CREDENTIALS');
    expect(g.template.retryable).toBe(true);
  });

  it('falls back to general:UNKNOWN for an unrecognised code', () => {
    const g = getErrorGuidance('github', 'TOTALLY_UNKNOWN_CODE');
    expect(g.template.title).toBe('An unexpected error occurred');
    expect(g.template.retryable).toBe(true);
  });

  it('falls back to general:UNKNOWN for an unrecognised domain', () => {
    // @ts-expect-error — intentionally passing an invalid domain
    const g = getErrorGuidance('unknown_domain', 'SOME_CODE');
    expect(g.template.title).toBe('An unexpected error occurred');
  });

  it('every guidance entry has at least one step and one link', () => {
    const domains = ['github', 'vercel', 'stripe', 'stellar', 'auth'] as const;
    const codes: Record<string, string[]> = {
      github: ['AUTH_FAILED', 'RATE_LIMITED', 'COLLISION', 'NETWORK_ERROR', 'CONFIGURATION_ERROR'],
      vercel: ['AUTH_FAILED', 'RATE_LIMITED', 'PROJECT_EXISTS', 'NETWORK_ERROR'],
      stripe: ['CARD_DECLINED', 'WEBHOOK_SIGNATURE_INVALID', 'SUBSCRIPTION_NOT_FOUND'],
      stellar: ['INSUFFICIENT_BALANCE', 'NETWORK_MISMATCH', 'TRANSACTION_FAILED', 'ENDPOINT_UNREACHABLE'],
      auth: ['INVALID_CREDENTIALS', 'EMAIL_TAKEN'],
    };

    for (const domain of domains) {
      for (const code of codes[domain]) {
        const g = getErrorGuidance(domain, code);
        expect(g.steps.length, `${domain}:${code} steps`).toBeGreaterThan(0);
        expect(g.links.length, `${domain}:${code} links`).toBeGreaterThan(0);
      }
    }
  });
});

describe('formatMessage', () => {
  it('replaces known placeholders', () => {
    const result = formatMessage('Wait {retryAfter} seconds.', { retryAfter: '60' });
    expect(result).toBe('Wait 60 seconds.');
  });

  it('leaves unknown placeholders intact', () => {
    const result = formatMessage('Error: {code}', {});
    expect(result).toBe('Error: {code}');
  });

  it('replaces multiple distinct placeholders', () => {
    const result = formatMessage('{name} failed with {resultCode}.', {
      name: 'tx',
      resultCode: 'op_no_trust',
    });
    expect(result).toBe('tx failed with op_no_trust.');
  });

  it('returns the template unchanged when values is omitted', () => {
    const msg = 'No placeholders here.';
    expect(formatMessage(msg)).toBe(msg);
  });
});
