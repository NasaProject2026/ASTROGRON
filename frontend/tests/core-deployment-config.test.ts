// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { configuredCoreEndpoint } from '@/server/core-backend';

describe('Scientific backend deployment boundary', () => {
  it('supports the Windows loopback demonstration explicitly', () => {
    expect(configuredCoreEndpoint('http://127.0.0.1:8790', []).origin).toBe('http://127.0.0.1:8790');
  });
  it('supports an allowlisted TLS backend without frontend code changes', () => {
    expect(configuredCoreEndpoint('https://science.example.org', ['science.example.org']).origin).toBe('https://science.example.org');
  });
  it('rejects missing configuration, insecure remote hosts and missing allowlists', () => {
    expect(() => configuredCoreEndpoint(undefined, [])).toThrow('CORE_ENDPOINT_REQUIRED');
    expect(() => configuredCoreEndpoint('http://science.example.org', ['science.example.org'])).toThrow();
    expect(() => configuredCoreEndpoint('https://science.example.org', [])).toThrow();
  });
  it('rejects metadata addresses, credentials and endpoint path overrides', () => {
    expect(() => configuredCoreEndpoint('https://metadata.google.internal', ['metadata.google.internal'])).toThrow();
    expect(() => configuredCoreEndpoint('https://user:password@science.example.org', ['science.example.org'])).toThrow();
    expect(() => configuredCoreEndpoint('https://science.example.org/other-service', ['science.example.org'])).toThrow();
  });
});
