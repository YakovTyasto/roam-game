import { describe, it, expect } from 'vitest';
import { buildInviteUrl, parseRoomCodeFromUrl } from './inviteLink';

describe('parseRoomCodeFromUrl', () => {
  it('parses a full invite URL', () => {
    expect(parseRoomCodeFromUrl('https://roam.example/?room=ABC234')).toBe('ABC234');
  });

  it('parses a bare query string', () => {
    expect(parseRoomCodeFromUrl('?room=abc234')).toBe('ABC234');
    expect(parseRoomCodeFromUrl('room=abc234')).toBe('ABC234');
  });

  it('normalises case', () => {
    expect(parseRoomCodeFromUrl('https://x.y/?room=abc234')).toBe('ABC234');
  });

  it('returns null for a missing param', () => {
    expect(parseRoomCodeFromUrl('https://x.y/?foo=bar')).toBeNull();
    expect(parseRoomCodeFromUrl('')).toBeNull();
    expect(parseRoomCodeFromUrl(null)).toBeNull();
  });

  it('returns null for an invalid code (wrong length / bad chars)', () => {
    expect(parseRoomCodeFromUrl('?room=ABC')).toBeNull();
    expect(parseRoomCodeFromUrl('?room=ABC01O')).toBeNull();
  });

  it('preserves other params but still finds the code', () => {
    expect(parseRoomCodeFromUrl('https://x.y/?utm=1&room=ABC234&x=2')).toBe('ABC234');
  });
});

describe('buildInviteUrl', () => {
  it('builds a ?room= link from an origin', () => {
    expect(buildInviteUrl('ABC234', 'https://roam.example')).toBe(
      'https://roam.example/?room=ABC234',
    );
  });

  it('round-trips with the parser', () => {
    const url = buildInviteUrl('XYZ789', 'https://roam.example');
    expect(parseRoomCodeFromUrl(url)).toBe('XYZ789');
  });
});
