import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { pickBotReply } from './pick-bot-reply';
import { BOT_REPLIES } from '../bot-messages.data';
import { EBotReplyCategory } from '../t-bot-reply';

describe('pickBotReply', () => {
    it('picks a reply from the requested category', () => {
        const random = createSeededRandom(1);

        const reply = pickBotReply(EBotReplyCategory.Happy, random);

        expect(reply.category).toBe(EBotReplyCategory.Happy);
        expect(BOT_REPLIES).toContainEqual(reply);
    });

    it('is deterministic for the same seed', () => {
        const reply1 = pickBotReply(EBotReplyCategory.Angry, createSeededRandom('battle-1'));
        const reply2 = pickBotReply(EBotReplyCategory.Angry, createSeededRandom('battle-1'));

        expect(reply1).toEqual(reply2);
    });

    it('can produce different replies across draws from the same random stream', () => {
        const random = createSeededRandom(7);
        const seen = new Set<string>();

        for (let i = 0; i < 20; i++) {
            seen.add(pickBotReply(EBotReplyCategory.Angry, random).text);
        }

        expect(seen.size).toBeGreaterThan(1);
    });
});
