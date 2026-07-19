import { shareLink, type TShareStatus } from '@/shared/lib/share';
import type { TDailySharePayload } from './build-share-text';

export type TShareDailyResultStatus = TShareStatus;

/** Делится результатом «Боя дня» — тонкая обёртка над общим `shareLink` (см. `@/shared/lib/share`). */
export async function shareDailyResult(
    payload: TDailySharePayload,
): Promise<TShareDailyResultStatus> {
    return shareLink(payload);
}
