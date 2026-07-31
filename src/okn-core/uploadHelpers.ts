export type UploadPhase = 'idle' | 'uploading' | 'complete' | 'failed';

export interface UploadStatus {
  phase: UploadPhase;
  supabaseRowId: string | null;
  csvPath: string | null;
  error: string | null;
}

/** Given upload status, decide what the BAC submit button should do. */
export function resolveBacAction(
  phase: UploadPhase,
  rowId: string | null,
  hasPendingMetadata: boolean
): 'submit_now' | 'queue' | 'show_error' | 'disabled' {
  if (!hasPendingMetadata) return 'disabled';
  if (phase === 'complete' && rowId) return 'submit_now';
  if (phase === 'uploading') return 'queue';
  if (phase === 'failed') return 'show_error';
  return 'disabled';
}

/** Parse upload-state-change event detail into UploadStatus. */
export function parseUploadEvent(detail: Record<string, unknown>): UploadStatus {
  return {
    phase: (detail.phase as UploadPhase) ?? 'idle',
    supabaseRowId: (detail.supabaseRowId as string) ?? null,
    csvPath: (detail.csvPath as string) ?? null,
    error: (detail.error as string) ?? null,
  };
}
