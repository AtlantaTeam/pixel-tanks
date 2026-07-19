import { EBotReplyCategory } from '../t-bot-reply';
import type { TBotReplyEvent } from './t-bot-reply-event';

/**
 * Промах и самострел бот воспринимает одинаково саркастично — категория
 * зависит только от того, задело ли противника, и если да — кто стрелял.
 */
export const resolveBotReplyCategory = ({
    shooterIsBot,
    hit,
}: TBotReplyEvent): EBotReplyCategory => {
    if (hit !== 'opponent') return EBotReplyCategory.Sarcasm;
    return shooterIsBot ? EBotReplyCategory.Happy : EBotReplyCategory.Angry;
};
