'use client';

import { useState } from 'react';
import { shareLink, type TSharePayload, type TShareStatus } from '@/shared/lib/share';
import { Button } from '../button';

type TShareButtonProps = {
    label: string;
    /**
     * Ленивая сборка payload: строится в обработчике (нужен `window.location`),
     * а не при рендере. Может бросить (например, кодек реплея при нарушенном
     * инварианте записи) — тогда честно показываем «не удалось поделиться».
     */
    buildPayload: () => TSharePayload;
};

const STATUS_HINT: Partial<Record<TShareStatus, string>> = {
    copied: 'Ссылка скопирована в буфер обмена',
    unavailable: 'Не удалось поделиться — скопируйте ссылку из адресной строки',
};

/**
 * Кнопка «Поделиться»: Web Share API или копирование в буфер (см. `shareLink`).
 * Подсказка о результате объявляется скринридеру (`aria-live`). Общая для
 * реплея и «Боя дня» — расходятся только текстом и сборкой payload.
 */
export function ShareButton({ label, buildPayload }: TShareButtonProps) {
    const [status, setStatus] = useState<TShareStatus | 'idle'>('idle');

    const handleShare = async () => {
        let payload: TSharePayload;
        try {
            payload = buildPayload();
        } catch {
            setStatus('unavailable');
            return;
        }
        setStatus(await shareLink(payload));
    };

    // STATUS_HINT — единственная точка правды о том, какие статусы показываются
    // (успешный share и отмена подсказки не требуют).
    const hint = status === 'idle' ? undefined : STATUS_HINT[status];

    return (
        <div className="mt-4 flex flex-col items-center gap-2">
            <Button variant="ghost" size="md" onClick={handleShare}>
                {label}
            </Button>
            {hint ? (
                <p className="text-[10px] text-muted" aria-live="polite">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}
