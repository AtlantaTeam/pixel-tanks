import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { resolveBotReplyCategory } from '../lib/resolve-bot-reply-category';
import { pickBotReply } from '../lib/pick-bot-reply';
import type { TBotReplyEvent } from '../lib/t-bot-reply-event';
import { EBotReplyCategory } from '../t-bot-reply';

/**
 * Полный пайплайн события выстрела: resolveBotReplyCategory определяет
 * категорию, pickBotReply выбирает текст той же категории через инжектируемый
 * random. Юнит-тесты на каждый шаг живут рядом с реализацией — здесь
 * проверяется их совместная сборка, как её вызывает GamePlay.emitBotReply.
 */
describe('bot reply pipeline (event -> category -> reply)', () => {
    const cases: Array<{ name: string; event: TBotReplyEvent; category: EBotReplyCategory }> = [
        {
            name: 'bot hits the player',
            event: { shooterIsBot: true, hit: 'opponent' },
            category: EBotReplyCategory.Happy,
        },
        {
            name: 'player hits the bot',
            event: { shooterIsBot: false, hit: 'opponent' },
            category: EBotReplyCategory.Angry,
        },
        {
            name: 'bot hits itself',
            event: { shooterIsBot: true, hit: 'self' },
            category: EBotReplyCategory.Sarcasm,
        },
        {
            name: 'complete miss',
            event: { shooterIsBot: false, hit: 'none' },
            category: EBotReplyCategory.Sarcasm,
        },
    ];

    it.each(cases)('$name -> reply of category $category', ({ event, category }) => {
        const random = createSeededRandom('pipeline-seed');

        const resolvedCategory = resolveBotReplyCategory(event);
        const reply = pickBotReply(resolvedCategory, random);

        expect(resolvedCategory).toBe(category);
        expect(reply.category).toBe(category);
    });

    it('is fully deterministic for the same event sequence and seed', () => {
        const run = () => {
            const random = createSeededRandom('battle-42');
            return cases.map(({ event }) => pickBotReply(resolveBotReplyCategory(event), random));
        };

        expect(run()).toEqual(run());
    });
});
