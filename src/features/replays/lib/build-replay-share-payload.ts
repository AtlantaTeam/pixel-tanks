import { encodeReplay, type TReplay } from '@/entities/replays';
import { APP_NAME } from '@/shared/config';

export type TBuildReplayShareInput = TReplay & { origin: string };

export type TReplaySharePayload = {
    title: string;
    text: string;
    url: string;
};

/** Собирает приглашение «Поделиться» с ссылкой на покадровый реплей боя. */
export function buildReplayShareText({
    seed,
    moves,
    origin,
}: TBuildReplayShareInput): TReplaySharePayload {
    const code = encodeReplay({ seed, moves });
    return {
        title: `${APP_NAME} — Реплей боя`,
        text: `Смотри мой бой в ${APP_NAME}!`,
        url: `${origin}/replay/${code}`,
    };
}
