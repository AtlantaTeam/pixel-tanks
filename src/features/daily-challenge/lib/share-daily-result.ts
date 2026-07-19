import type { TDailySharePayload } from './build-share-text';

export type TShareDailyResultStatus = 'shared' | 'copied' | 'cancelled' | 'unavailable';

/**
 * Делится результатом «Боя дня»: Web Share API на устройствах, где он есть
 * (мобилки), иначе — копирование ссылки в буфер обмена. Отмену шаринга
 * пользователем (AbortError) не считаем ошибкой и не откатываемся к буферу —
 * это был явный отказ, а не сбой.
 */
export async function shareDailyResult(
    payload: TDailySharePayload,
): Promise<TShareDailyResultStatus> {
    if (typeof navigator !== 'undefined' && navigator.share) {
        try {
            await navigator.share(payload);
            return 'shared';
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
        }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
        try {
            // writeText тоже может отклониться: нет фокуса документа, отказ в
            // разрешении, non-secure context — тогда честно возвращаем 'unavailable'.
            await navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
            return 'copied';
        } catch {
            return 'unavailable';
        }
    }

    return 'unavailable';
}
