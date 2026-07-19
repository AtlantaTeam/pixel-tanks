'use client';

import { ShareButton } from '@/shared/ui';
import { buildDailyShareText } from '../../lib/build-share-text';

type TShareDailyResultButtonProps = {
    points: number;
    seed: string;
};

export function ShareDailyResultButton({ points, seed }: TShareDailyResultButtonProps) {
    return (
        <ShareButton
            label="Поделиться"
            buildPayload={() =>
                buildDailyShareText({ points, seed, origin: window.location.origin })
            }
        />
    );
}
