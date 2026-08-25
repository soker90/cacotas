import type { SyncRequest, SyncResponse } from './types.ts';

/** Transport abstraction of SPEC.md §9.5. */
export interface SyncBackend {
  sync(req: SyncRequest): Promise<SyncResponse>;
}

export type { SyncRequest, SyncResponse };
