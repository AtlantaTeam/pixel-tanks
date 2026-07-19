import { EBotReplyCategory } from '../t-bot-reply';
import type { TBotReplyEvent } from '../t-bot-reply-event';

/**
 * Категория реплики по исходу выстрела. `null` — бот молчит.
 *
 * Реплика всегда всплывает над танком бота, поэтому сарказм про «харакири»
 * уместен лишь когда пострадал сам игрок — он подорвал себя (как в оригинале
 * `sendBotMessage`: `leftTank === bullet.hittedTank`). Свой промах или самострел
 * бот не комментирует, иначе глумился бы над собственной же головой.
 */
export const resolveBotReplyCategory = ({
    shooterIsBot,
    hit,
}: TBotReplyEvent): EBotReplyCategory | null => {
    if (hit === 'opponent') {
        return shooterIsBot ? EBotReplyCategory.Happy : EBotReplyCategory.Angry;
    }
    // Сарказм — только самострел игрока; промах любого и самострел бота → молчание.
    if (hit === 'self' && !shooterIsBot) return EBotReplyCategory.Sarcasm;
    return null;
};
