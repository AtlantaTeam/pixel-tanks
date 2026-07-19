'use client';

import { useState } from 'react';
import type { TReplay } from '@/entities/replays';
import { shareLink, type TShareStatus } from '@/shared/lib/share';
import { Button } from '@/shared/ui';
import { buildReplayShareText } from '../../lib/build-replay-share-payload';

type TShareReplayButtonProps = TReplay;

const STATUS_HINT: Partial<Record<TShareStatus, string>> = {
    copied: 'Ссылка скопирована в буфер обмена',
    unavailable: 'Не удалось поделиться — скопируйте ссылку из адресной строки',
};

export function ShareReplayButton({ seed, moves }: TShareReplayButtonProps) {
    const [status, setStatus] = useState<TShareStatus | 'idle'>('idle');

    const handleShare = async () => {
        const payload = buildReplayShareText({ seed, moves, origin: window.location.origin });
        const result = await shareLink(payload);
        setStatus(result);
    };

    return (
        <div className="mt-4 flex flex-col items-center gap-2">
            <Button variant="ghost" size="md" onClick={handleShare}>
                Поделиться боем
            </Button>
            {status !== 'idle' && status !== 'shared' && status !== 'cancelled' ? (
                <p className="text-[10px] text-muted">{STATUS_HINT[status]}</p>
            ) : null}
        </div>
    );
}
