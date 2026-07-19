'use server';

import { getPayload } from 'payload';
import { z } from 'zod';
import config from '@/payload.config';
import { DAILY_SEED_PATTERN, getDailySeed } from './daily-seed';

/**
 * Верхний предел очков за один бой. До Auth сервер не может доверять клиенту,
 * поэтому кроме `min(0)` вводим здравый потолок — иначе аноним отправил бы
 * `Number.MAX_SAFE_INTEGER` и возглавил лидерборд дня.
 */
export const MAX_DAILY_POINTS = 100_000;

const submitDailyScoreSchema = z.object({
    // Seed обязан быть daily-формата И относиться к текущим UTC-суткам —
    // так отсекаем и произвольные, и «вчерашние»/«завтрашние» записи.
    seed: z
        .string()
        .regex(DAILY_SEED_PATTERN)
        .refine((seed) => seed === getDailySeed(), {
            message: 'seed must be the current day daily seed',
        }),
    points: z.number().int().min(0).max(MAX_DAILY_POINTS),
    opponent: z.string().min(1).optional(),
});

export type TSubmitDailyScoreInput = z.infer<typeof submitDailyScoreSchema>;

/**
 * Пишет результат «Боя дня» в Payload через Local API (overrideAccess по
 * умолчанию) — до фазы Auth у игрока нет сессии, поэтому REST-гейт
 * `create: Boolean(req.user)` для него закрыт, а доверенный серверный вызов
 * его обходит и помечает запись `dailySeed`.
 */
export async function submitDailyScore(input: TSubmitDailyScoreInput) {
    const data = submitDailyScoreSchema.parse(input);
    const payload = await getPayload({ config });

    return payload.create({
        collection: 'scores',
        data: {
            points: data.points,
            // `opponent` не задан → полагаемся на defaultValue коллекции scores,
            // не дублируем дефолт «Terminator» здесь.
            opponent: data.opponent,
            dailySeed: data.seed,
        },
    });
}
