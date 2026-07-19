import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { resolveBotReplyCategory } from './resolve-bot-reply-category';
import { pickBotReply } from './pick-bot-reply';
import type { TBotReplyEvent } from '../t-bot-reply-event';
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
            name: 'player blows itself up',
            event: { shooterIsBot: false, hit: 'self' },
            category: EBotReplyCategory.Sarcasm,
        },
    ];

    const silentCases: Array<{ name: string; event: TBotReplyEvent }> = [
        { name: 'bot hits itself', event: { shooterIsBot: true, hit: 'self' } },
        { name: 'bot misses', event: { shooterIsBot: true, hit: 'none' } },
        { name: 'player misses', event: { shooterIsBot: false, hit: 'none' } },
    ];

    it.each(cases)('$name -> reply of category $category', ({ event, category }) => {
        const random = createSeededRandom('pipeline-seed');

        const resolvedCategory = resolveBotReplyCategory(event);
        expect(resolvedCategory).toBe(category);

        const reply = pickBotReply(resolvedCategory!, random);
        expect(reply.category).toBe(category);
    });

    it.each(silentCases)('$name -> bot stays silent (null category)', ({ event }) => {
        expect(resolveBotReplyCategory(event)).toBeNull();
    });

    it('is fully deterministic for the same event sequence and seed', () => {
        const run = () => {
            const random = createSeededRandom('battle-42');
            return cases.map(({ event }) => {
                const category = resolveBotReplyCategory(event);
                return pickBotReply(category!, random);
            });
        };

        expect(run()).toEqual(run());
    });
});
