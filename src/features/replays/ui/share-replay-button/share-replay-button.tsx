'use client';

import type { TReplay } from '@/entities/replays';
import { ShareButton } from '@/shared/ui';
import { buildReplaySharePayload } from '../../lib/build-replay-share-payload';

type TShareReplayButtonProps = TReplay;

export function ShareReplayButton({ seed, width, height, moves }: TShareReplayButtonProps) {
    return (
        <ShareButton
            label="Поделиться боем"
            buildPayload={() =>
                buildReplaySharePayload({
                    seed,
                    width,
                    height,
                    moves,
                    origin: window.location.origin,
                })
            }
        />
    );
}
