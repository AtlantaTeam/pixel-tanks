import { APP_NAME } from '@/shared/config';
import { pluralizeRu } from '@/shared/lib/plural';

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
    // «Мой результат …» вместо «Я набрал …» — заодно уходим от жёсткого
    // мужского рода (полноценная локализация рода/числа — фаза 10).
    const pointsWord = pluralizeRu(points, ['очко', 'очка', 'очков']);
    return {
        title: `${APP_NAME} — Бой дня`,
        text: `Мой результат в «Бое дня» ${APP_NAME} — ${points} ${pointsWord}! Повтори с тем же ветром и террейном:`,
        url: `${origin}/game?seed=${seed}`,
    };
}
