'use server';

import { getPayload } from 'payload';
import { z } from 'zod';
import config from '@/payload.config';

const submitDailyScoreSchema = z.object({
    seed: z.string().min(1),
    points: z.number().int().min(0),
    opponent: z.string().min(1).optional(),
    durationSec: z.number().min(0).optional(),
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
            opponent: data.opponent ?? 'Terminator',
            durationSec: data.durationSec,
            dailySeed: data.seed,
        },
    });
}
