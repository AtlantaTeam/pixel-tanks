import { describe, expect, it } from 'vitest';
import { resolveBotReplyCategory } from './resolve-bot-reply-category';
import { EBotReplyCategory } from '../t-bot-reply';

describe('resolveBotReplyCategory', () => {
    it('returns Happy when the bot hits the player', () => {
        expect(resolveBotReplyCategory({ shooterIsBot: true, hit: 'opponent' })).toBe(
            EBotReplyCategory.Happy,
        );
    });

    it('returns Angry when the player hits the bot', () => {
        expect(resolveBotReplyCategory({ shooterIsBot: false, hit: 'opponent' })).toBe(
            EBotReplyCategory.Angry,
        );
    });

    it('returns Sarcasm only when the player blows itself up', () => {
        expect(resolveBotReplyCategory({ shooterIsBot: false, hit: 'self' })).toBe(
            EBotReplyCategory.Sarcasm,
        );
    });

    it('stays silent (null) when the bot blows itself up — no taunt over its own head', () => {
        expect(resolveBotReplyCategory({ shooterIsBot: true, hit: 'self' })).toBeNull();
    });

    it('stays silent (null) on a complete miss, regardless of who fired', () => {
        expect(resolveBotReplyCategory({ shooterIsBot: false, hit: 'none' })).toBeNull();
        expect(resolveBotReplyCategory({ shooterIsBot: true, hit: 'none' })).toBeNull();
    });
});
