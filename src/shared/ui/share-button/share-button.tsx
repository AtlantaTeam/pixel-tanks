'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { shareLink, type TSharePayload, type TShareStatus } from '@/shared/lib/share';
import { Button, type TButtonVariant } from '../button';

type TShareButtonProps = {
    label: string;
    /**
     * Ленивая сборка payload: строится в обработчике (нужен `window.location`),
     * а не при рендере. Может бросить (например, кодек реплея при нарушенном
     * инварианте записи) — тогда честно показываем «не удалось поделиться».
     */
    buildPayload: () => TSharePayload;
    /** По умолчанию `ghost` (общий showcase/«Бой дня»). Боевой game-over
     *  (handoff «Поделиться реплеем») передаёт `outline` — контурный accent. */
    variant?: TButtonVariant;
    /** Кнопка на всю ширину, без своего верхнего отступа — для стопки кнопок
     *  game-over (handoff: все кнопки min-height 48px, стопкой, одной ширины). */
    fullWidth?: boolean;
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
export function ShareButton({
    label,
    buildPayload,
    variant = 'ghost',
    fullWidth = false,
}: TShareButtonProps) {
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
        <div
            className={clsx(
                'flex flex-col gap-2',
                fullWidth ? 'w-full items-stretch' : 'mt-4 items-center',
            )}
        >
            <Button
                variant={variant}
                size="md"
                className={fullWidth ? 'min-h-12 w-full' : undefined}
                onClick={handleShare}
            >
                {label}
            </Button>
            {hint ? (
                <p className="text-[10px] text-text-muted" aria-live="polite">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}
