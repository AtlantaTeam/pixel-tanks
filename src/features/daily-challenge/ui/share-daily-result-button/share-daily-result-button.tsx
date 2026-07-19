'use client';

import { useState } from 'react';
import { Button } from '@/shared/ui';
import { buildDailyShareText } from '../../lib/build-share-text';
import { shareDailyResult, type TShareDailyResultStatus } from '../../lib/share-daily-result';

type TShareDailyResultButtonProps = {
    points: number;
    seed: string;
};

const STATUS_HINT: Partial<Record<TShareDailyResultStatus, string>> = {
    copied: 'Ссылка скопирована в буфер обмена',
    unavailable: 'Не удалось поделиться — скопируйте ссылку из адресной строки',
};

export function ShareDailyResultButton({ points, seed }: TShareDailyResultButtonProps) {
    const [status, setStatus] = useState<TShareDailyResultStatus | 'idle'>('idle');

    const handleShare = async () => {
        const payload = buildDailyShareText({ points, seed, origin: window.location.origin });
        const result = await shareDailyResult(payload);
        setStatus(result);
    };

    return (
        <div className="mt-4 flex flex-col items-center gap-2">
            <Button variant="ghost" size="md" onClick={handleShare}>
                Поделиться
            </Button>
            {status !== 'idle' && status !== 'shared' && status !== 'cancelled' ? (
                <p className="text-[10px] text-muted">{STATUS_HINT[status]}</p>
            ) : null}
        </div>
    );
}
