import { describe, it, expect } from 'vitest';
import { resolveBacAction, parseUploadEvent } from '../uploadHelpers';

describe('uploadHelpers', () => {
  describe('resolveBacAction', () => {
    it('returns submit_now when upload complete with rowId and pending metadata', () => {
      expect(resolveBacAction('complete', 'row-123', true)).toBe('submit_now');
    });

    it('returns queue when uploading with pending metadata', () => {
      expect(resolveBacAction('uploading', null, true)).toBe('queue');
    });

    it('returns show_error when upload failed with pending metadata', () => {
      expect(resolveBacAction('failed', null, true)).toBe('show_error');
    });

    it('returns disabled when upload complete but no pending metadata', () => {
      expect(resolveBacAction('complete', 'row-123', false)).toBe('disabled');
    });

    it('returns disabled when idle with pending metadata', () => {
      expect(resolveBacAction('idle', null, true)).toBe('disabled');
    });
  });

  describe('parseUploadEvent', () => {
    it('parses complete event with supabaseRowId', () => {
      const status = parseUploadEvent({ phase: 'complete', supabaseRowId: 'abc' });
      expect(status.phase).toBe('complete');
      expect(status.supabaseRowId).toBe('abc');
      expect(status.csvPath).toBeNull();
      expect(status.error).toBeNull();
    });

    it('defaults to idle with nulls for empty detail', () => {
      const status = parseUploadEvent({});
      expect(status.phase).toBe('idle');
      expect(status.supabaseRowId).toBeNull();
      expect(status.csvPath).toBeNull();
      expect(status.error).toBeNull();
    });

    it('parses failed event with error message', () => {
      const status = parseUploadEvent({ phase: 'failed', error: 'timeout' });
      expect(status.phase).toBe('failed');
      expect(status.error).toBe('timeout');
      expect(status.supabaseRowId).toBeNull();
    });
  });
});
