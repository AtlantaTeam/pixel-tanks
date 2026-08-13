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

/**
 * Единый период завёртки смещения облаков (и диапазон стартового разброса).
 * Условная величина: реальная ширина тайла зависит от арта и размера канваса —
 * период нужен лишь чтобы `offset` не рос бесконечно за долгий бой. Стартовый
 * разброс и `advanceOffset` в `sky-scene` пользуются ОДНОЙ константой, чтобы
 * инвариант «offset в [0, period)» не разъехался между стартом и движением.
 */
export const CLOUD_OFFSET_PERIOD = 100000;

/**
 * Детерминированно раскладывает стартовые смещения слоёв по сиду боя. Один сид —
 * то же положение облаков на старте (критерий готовности #479). Namespaced суффикс
 * `::clouds` держит выбор в отдельном потоке RNG, не трогая основную
 * последовательность боя (рельеф/ветер/бот), — иначе реплей того же сида разошёлся бы.
 */
export const createInitialOffsets = (seed: number | string, count: number): number[] => {
    const random = createSeededRandom(`${seed}::clouds`);
    return Array.from({ length: count }, () => random() * CLOUD_OFFSET_PERIOD);
};
