import { describe, expect, it } from 'vitest';
import { allowedFromPage, parseSse } from './daemon.js';

describe('parseSse', () => {
  it('splits events, counts pings and keeps the partial tail', () => {
    const raw = ': open\n\ndata: {"seq":1,"level":"status","message":"hi"}\n\n: ping\n\ndata: {"seq":2';
    const { events, pings, rest } = parseSse(raw);
    expect(events).toEqual([{ seq: 1, level: 'status', message: 'hi' }]);
    expect(pings).toBe(2);
    expect(rest).toBe('data: {"seq":2');
  });
});

describe('allowedFromPage', () => {
  it('lets pages use the run API but not rewrite the daemon config', () => {
    expect(allowedFromPage('GET', '/config')).toBe(true);
    expect(allowedFromPage('GET', '/fs/list?path=%2Ftmp')).toBe(true);
    expect(allowedFromPage('POST', '/dispatch')).toBe(true);
    expect(allowedFromPage('DELETE', '/dispatch/0b1c-22')).toBe(true);
    expect(allowedFromPage('PUT', '/config')).toBe(false);
    expect(allowedFromPage('GET', '/configx')).toBe(false);
    expect(allowedFromPage('POST', '/dispatch/../config')).toBe(false);
  });
});
