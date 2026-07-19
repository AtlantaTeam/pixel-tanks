import { encodeReplay, type TReplay } from '@/entities/replays';
import { APP_NAME } from '@/shared/config';
import type { TSharePayload } from '@/shared/lib/share';

export type TBuildReplayShareInput = TReplay & { origin: string };

/** Собирает приглашение «Поделиться» с ссылкой на покадровый реплей боя. */
export function buildReplaySharePayload({
    seed,
    width,
    height,
    moves,
    origin,
}: TBuildReplayShareInput): TSharePayload {
    const code = encodeReplay({ seed, width, height, moves });
    return {
        title: `${APP_NAME} — Реплей боя`,
        text: `Смотри мой бой в ${APP_NAME}!`,
        url: `${origin}/replay/${code}`,
    };
}
