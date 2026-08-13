import { createSeededRandom } from '@/shared/lib/random';

/** Точка градиента неба: смещение [0..1] сверху вниз и цвет. */
export type TSkyStop = {
    offset: number;
    color: string;
};

export type TSkyPresetId = 'day' | 'sunset' | 'night';

/**
 * Пресет времени суток сцены боя — кодификация арта из [ЧЕЛОВЕК]-карточки #478
 * (палитры неба день/закат/ночь). Только цветовые данные сцены: градиент неба,
 * тон силуэта дальних гор и тон/прозрачность облаков. Пресет выбирается сидом боя
 * (`pickSkyPreset`), поэтому один сид даёт одну и ту же сцену — как рельеф и ветер.
 */
export type TSkyPreset = {
    id: TSkyPresetId;
    /** Человекочитаемое имя — для витрины `/design-system`. */
    name: string;
    /** Стопы вертикального градиента неба (сверху вниз). */
    sky: TSkyStop[];
    /** Тон силуэта дальних гор. */
    mountain: string;
    /** Базовый тон облаков (умножается на `cloudAlpha` при отрисовке). */
    cloud: string;
    /** Прозрачность облачных слоёв: днём плотные, ночью еле видны. */
    cloudAlpha: number;
};

export const SKY_PRESETS: readonly TSkyPreset[] = [
    {
        id: 'day',
        name: 'День',
        sky: [
            { offset: 0, color: '#3a7bd5' },
            { offset: 0.55, color: '#5f9fe0' },
            { offset: 1, color: '#bfe0f2' },
        ],
        mountain: '#5b6f93',
        cloud: '#f4f9ff',
        cloudAlpha: 0.9,
    },
    {
        id: 'sunset',
        name: 'Закат',
        sky: [
            { offset: 0, color: '#26305f' },
            { offset: 0.5, color: '#8a4a6b' },
            { offset: 0.78, color: '#d9713e' },
            { offset: 1, color: '#f4b26a' },
        ],
        mountain: '#42324f',
        cloud: '#ffd9b0',
        cloudAlpha: 0.72,
    },
    {
        id: 'night',
        name: 'Ночь',
        sky: [
            { offset: 0, color: '#070a22' },
            { offset: 0.6, color: '#141a44' },
            { offset: 1, color: '#28305f' },
        ],
        mountain: '#0e1330',
        cloud: '#b9c6f2',
        cloudAlpha: 0.5,
    },
];

const PRESET_BY_ID = new Map<string, TSkyPreset>(SKY_PRESETS.map((preset) => [preset.id, preset]));

/**
 * Детерминированно выбирает пресет времени суток по сиду боя. Сид домешивается
 * суффиксом `::sky` в отдельный поток RNG, чтобы не сдвигать основную
 * последовательность `createSeededRandom(seed)`, из которой генерятся рельеф,
 * ветер и выборки бота (иначе реплей того же сида разошёлся бы).
 */
export const pickSkyPreset = (seed: number | string): TSkyPreset => {
    const random = createSeededRandom(`${seed}::sky`);
    const index = Math.floor(random() * SKY_PRESETS.length);
    // Клэмп на случай теоретического random() === 1 у чужой реализации RNG.
    return SKY_PRESETS[Math.min(index, SKY_PRESETS.length - 1)];
};

/**
 * Возвращает пресет по идентификатору — для витрины, где сцена показывается
 * принудительно в каждом из трёх вариантов. Неизвестный id — исключение
 * (fail-closed), а не тихий дефолт на первый пресет.
 */
export const pickSkyPresetById = (id: TSkyPresetId): TSkyPreset => {
    const preset = PRESET_BY_ID.get(id);
    if (!preset) {
        throw new Error(`Неизвестный пресет неба: ${id}`);
    }
    return preset;
};
