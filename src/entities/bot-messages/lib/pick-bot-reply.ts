import type { TSeededRandom } from '@/shared/lib/random';
import { BOT_REPLIES } from '../bot-messages.data';
import type { EBotReplyCategory, TBotReply } from '../t-bot-reply';

/**
 * Выбирает случайную реплику заданной категории через инжектируемый random —
 * детерминируемо для тестов и будущих реплеев (та же последовательность на тот же seed).
 */
export const pickBotReply = (category: EBotReplyCategory, random: TSeededRandom): TBotReply => {
    const pool = BOT_REPLIES.filter((reply) => reply.category === category);
    if (pool.length === 0) {
        // Инвариант данных: у каждой категории есть хотя бы одна реплика. Бросаем,
        // а не возвращаем undefined — иначе тип TBotReply лжёт и рендер упадёт позже.
        throw new Error(`Нет реплик категории «${category}»`);
    }
    // Клэмп на случай random() === 1 (index === pool.length → undefined).
    const index = Math.min(Math.floor(random() * pool.length), pool.length - 1);
    return pool[index];
};
