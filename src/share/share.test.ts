import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyLink, share } from './share';

/**
 * The share path is all fallbacks, and every fallback is a real device: iOS
 * Safari with no clipboard permission, an http:// preview with no secure
 * context, a desktop browser with no share sheet. These tests drive each one.
 */

const originalNavigator = globalThis.navigator;

function setNavigator(patch: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { ...originalNavigator, ...patch },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
});

describe('share', () => {
  it('uses the native sheet when available', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: nativeShare, clipboard: undefined });

    const result = await share({ title: 'Roam', text: 'I scored 21,500', url: 'https://x.y/c/AB' });

    expect(result.outcome).toBe('shared');
    expect(nativeShare).toHaveBeenCalledWith({
      title: 'Roam',
      text: 'I scored 21,500',
      url: 'https://x.y/c/AB',
    });
  });

  it('treats a dismissed share sheet as cancelled, not as a failure', async () => {
    // Copying to the clipboard after the user explicitly dismissed the sheet
    // would be doing the thing they just declined.
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } });

    const result = await share({ url: 'https://x.y/c/AB' });

    expect(result.outcome).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when the native share fails for another reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({
      share: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      clipboard: { writeText },
    });

    const result = await share({ text: 'I scored 21,500', url: 'https://x.y/c/AB' });

    expect(result.outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('I scored 21,500 https://x.y/c/AB');
  });

  it('drops files the platform cannot share instead of letting the sheet reject', async () => {
    // iOS Safari opens the sheet and only then rejects an unsupported file,
    // which looks like the app broke.
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(false);
    setNavigator({ share: nativeShare, canShare });

    const file = new File(['x'], 'card.png', { type: 'image/png' });
    const result = await share({ url: 'https://x.y/c/AB', files: [file] });

    expect(result.outcome).toBe('shared');
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    expect(nativeShare.mock.calls[0][0]).not.toHaveProperty('files');
  });

  it('keeps files when the platform says it can share them', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: nativeShare, canShare: vi.fn().mockReturnValue(true) });

    const file = new File(['x'], 'card.png', { type: 'image/png' });
    await share({ url: 'https://x.y/c/AB', files: [file] });

    expect(nativeShare.mock.calls[0][0].files).toEqual([file]);
  });

  it('copies when there is no share sheet at all', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: undefined, clipboard: { writeText } });

    const result = await share({ url: 'https://x.y/c/AB' });

    expect(result.outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x.y/c/AB');
  });

  it('falls back to execCommand when the clipboard API is unavailable', async () => {
    // The http:// preview / older iOS Safari case: no secure context, so
    // navigator.clipboard is simply not there.
    setNavigator({ share: undefined, clipboard: undefined });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });

    const result = await share({ url: 'https://x.y/c/AB' });

    expect(result.outcome).toBe('copied');
    expect(exec).toHaveBeenCalledWith('copy');
    // The temporary textarea must not be left behind in the DOM.
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('reports unsupported with the text to copy when everything fails', async () => {
    setNavigator({ share: undefined, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('nope')) } });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });

    const result = await share({ text: 'Roam', url: 'https://x.y/c/AB' });

    // Never a silent no-op: the UI gets something to show.
    expect(result.outcome).toBe('unsupported');
    expect(result.fallbackText).toBe('Roam https://x.y/c/AB');
  });
});

describe('copyLink', () => {
  it('copies without opening the share sheet', async () => {
    const nativeShare = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: nativeShare, clipboard: { writeText } });

    const result = await copyLink('https://x.y/c/AB');

    expect(result.outcome).toBe('copied');
    expect(nativeShare).not.toHaveBeenCalled();
  });

  it('reports failure with the text rather than pretending', async () => {
    setNavigator({ clipboard: undefined });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });

    const result = await copyLink('https://x.y/c/AB');

    expect(result.outcome).toBe('unsupported');
    expect(result.fallbackText).toBe('https://x.y/c/AB');
  });
});
