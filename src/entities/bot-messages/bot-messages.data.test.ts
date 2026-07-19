import { describe, it, expect } from 'vitest';
import { BOT_REPLIES } from './bot-messages.data';
import { EBotReplyCategory } from './t-bot-reply';

describe('bot-messages', () => {
    it('has at least 15 replies', () => {
        expect(BOT_REPLIES.length).toBeGreaterThanOrEqual(15);
    });

    it('has sarcasm category replies', () => {
        const sarcasm = BOT_REPLIES.filter((r) => r.category === EBotReplyCategory.Sarcasm);
        expect(sarcasm.length).toBeGreaterThan(0);
    });

    it('has happy category replies', () => {
        const happy = BOT_REPLIES.filter((r) => r.category === EBotReplyCategory.Happy);
        expect(happy.length).toBeGreaterThan(0);
    });

    it('has angry category replies', () => {
        const angry = BOT_REPLIES.filter((r) => r.category === EBotReplyCategory.Angry);
        expect(angry.length).toBeGreaterThan(0);
    });

    it('all replies have text and category', () => {
        BOT_REPLIES.forEach((reply) => {
            expect(reply.text).toBeTruthy();
            expect(reply.text.length).toBeGreaterThan(0);
            expect(Object.values(EBotReplyCategory)).toContain(reply.category);
        });
    });
});
