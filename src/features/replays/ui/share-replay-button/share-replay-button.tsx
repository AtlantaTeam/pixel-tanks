'use client';

import type { TReplay } from '@/entities/replays';
import { ShareButton } from '@/shared/ui';
import { buildReplaySharePayload } from '../../lib/build-replay-share-payload';

type TShareReplayButtonProps = TReplay;

export function ShareReplayButton({ seed, width, height, insets, moves }: TShareReplayButtonProps) {
    return (
        <ShareButton
            label="Поделиться реплеем"
            variant="outline"
            fullWidth
            buildPayload={() =>
                buildReplaySharePayload({
                    seed,
                    width,
                    height,
                    insets,
                    moves,
                    origin: window.location.origin,
                })
            }
        />
    );
}
