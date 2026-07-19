import { APP_NAME } from '@/shared/config';

export type TBuildDailyShareTextInput = {
    points: number;
    seed: string;
    origin: string;
};

export type TDailySharePayload = {
    title: string;
    text: string;
    url: string;
};

/** Собирает текст приглашения для «Поделиться» результатом «Боя дня». */
export function buildDailyShareText({
    points,
    seed,
    origin,
}: TBuildDailyShareTextInput): TDailySharePayload {
    return {
        title: `${APP_NAME} — Бой дня`,
        text: `Я набрал ${points} очков в «Бое дня» ${APP_NAME}! Повтори с тем же ветром и террейном:`,
        url: `${origin}/game?seed=${seed}`,
    };
}
