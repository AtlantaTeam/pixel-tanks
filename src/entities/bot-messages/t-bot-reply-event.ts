/** 'none' — промах, 'self' — попал в себя, 'opponent' — попал в противника. */
export type TBotReplyHit = 'none' | 'self' | 'opponent';

export type TBotReplyEvent = {
    shooterIsBot: boolean;
    hit: TBotReplyHit;
};
