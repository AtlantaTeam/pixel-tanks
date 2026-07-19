import type { TSeededRandom } from '@/shared/lib/random';
import { BOT_REPLIES } from '../bot-messages.data';
import type { EBotReplyCategory, TBotReply } from '../t-bot-reply';

/**
 * Выбирает случайную реплику заданной категории через инжектируемый random —
 * детерминируемо для тестов и будущих реплеев (та же последовательность на тот же seed).
 */
export const pickBotReply = (category: EBotReplyCategory, random: TSeededRandom): TBotReply => {
    const pool = BOT_REPLIES.filter((reply) => reply.category === category);
    const index = Math.floor(random() * pool.length);
    return pool[index];
};
