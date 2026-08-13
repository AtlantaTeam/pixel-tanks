import { createSeededRandom } from '@/shared/lib/random';

/**
 * Заворачивает смещение в диапазон `[0, span)`. Вырожденный span (0) — ровный
 * слой без повтора, возвращаем 0 вместо деления на ноль.
 */
export const wrapOffset = (value: number, span: number): number => {
    if (span <= 0) return 0;
    return ((value % span) + span) % span;
};

/**
 * Двигает смещение слоя по ВРЕМЕНИ, а не по кадрам: приращение = скорость (px/мс)
 * × dt (мс). Так на слабом устройстве облака едут ровно с той же скоростью, что и
 * на быстром (кадров меньше — dt каждого больше). Результат завёрнут по span, чтобы
 * смещение не росло бесконечно за долгий бой.
 */
export const advanceOffset = (offset: number, speed: number, dt: number, span: number): number =>
    wrapOffset(offset + speed * dt, span);

/** Условная ширина периода для стартовых смещений (реальный span зависит от арта). */
const INITIAL_OFFSET_RANGE = 100000;

/**
 * Детерминированно раскладывает стартовые смещения слоёв по сиду боя. Один сид —
 * то же положение облаков на старте (критерий готовности #479). Namespaced суффикс
 * `::clouds` держит выбор в отдельном потоке RNG, не трогая основную
 * последовательность боя (рельеф/ветер/бот), — иначе реплей того же сида разошёлся бы.
 */
export const createInitialOffsets = (seed: number | string, count: number): number[] => {
    const random = createSeededRandom(`${seed}::clouds`);
    return Array.from({ length: count }, () => random() * INITIAL_OFFSET_RANGE);
};
