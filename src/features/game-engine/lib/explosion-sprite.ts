/**
 * Пиксельный спрайт взрыва (issue #542). Разбор экрана боя нашёл корень «так себе»:
 * вспышка рисовалась мягким радиальным градиентом — идеальный круг с плавным
 * затуханием — РЯДОМ с пиксельными облаками и ступенчатыми горами. Взрыв был написан
 * в другой технике, чем сцена, и никакая палитра/радиус этого не спасали: все четыре
 * типа читались как «мягкий кружок другого оттенка».
 *
 * Лечение — шаг 0 разбора: считать взрыв в НИЗКОМ разрешении (решётка ячеек `r/S`) и
 * рисовать целыми пикселями `S×S` без сглаживания. Формула та же (яркое ядро → спад к
 * фронту), но ступенчатая, как остальная сцена. Альфа квантуется до 4 уровней — мягкое
 * затухание было второй причиной «мыла».
 *
 * Шаг 1 — силуэт как подпись типа: форма ячеек несёт узнаваемость ДО цвета (палитра
 * занята семантикой и на закате не читается). Четыре силуэта пиксельной маской:
 * фугас — круг с лучами, мощный — ромб с ободом ударной волны, кластер — плотный круг
 * очага, роющий — узкий конус вниз со столбом-фонтаном вверх.
 *
 * Модуль ЧИСТЫЙ (без канваса): решает, какие ячейки и с каким уровнем альфы залиты.
 * Рисует спрайт `paintExplosionFocus` (`weapon-specs.ts`). Разделение «модель считает —
 * ui рисует» из `canvas.md` плюс делает технику тестируемой без Canvas и детерминированной
 * (один вход → побитово тот же спрайт, критерий #542).
 */

/** Силуэт вспышки — подпись типа оружия формой, а не цветом (issue #542). */
export type TExplosionSilhouette = 'burst' | 'blast' | 'cluster' | 'digger';

/**
 * Целый масштаб ячейки решётки в пиксели канваса (S из шага 0). Строго целый —
 * дробный вернул бы сглаживание по краям, ради устранения которого всё и затевалось.
 */
export const EXPLOSION_PIXEL_SCALE = 3;

/** Число уровней альфы. У края вспышки не больше этого числа значений (критерий #542). */
export const EXPLOSION_ALPHA_LEVELS = 4;

/**
 * Пиксельный спрайт одного кадра очага: квадратная решётка ячеек, у каждой уровень
 * альфы 0..`EXPLOSION_ALPHA_LEVELS` (0 — пусто). Хранение row-major в `Uint8Array`.
 */
export type TExplosionSprite = Pick<TExplosionSpriteMetrics, 'size' | 'gridRadius' | 'scale'> & {
    /** Уровень каждой ячейки 0..`EXPLOSION_ALPHA_LEVELS`, row-major (длина size·size). */
    levels: Uint8Array;
};

/** Квантование нормированной яркости f∈(0,1] в уровень 1..`EXPLOSION_ALPHA_LEVELS`. */
function quantize(f: number): number {
    if (f <= 0) return 0;
    const level = Math.ceil(f * EXPLOSION_ALPHA_LEVELS);
    if (level < 1) return 1;
    if (level > EXPLOSION_ALPHA_LEVELS) return EXPLOSION_ALPHA_LEVELS;
    return level;
}

/** Запас ячеек вокруг очага под выступающие детали силуэта (лучи, обод, конус). */
function marginFor(silhouette: TExplosionSilhouette, gridRadius: number): number {
    switch (silhouette) {
        case 'burst':
            return Math.max(1, Math.round(gridRadius * 0.35));
        case 'blast':
            return 1;
        case 'cluster':
            return 0;
        case 'digger':
            return Math.max(1, Math.round(gridRadius * 0.4));
    }
}

/**
 * Габариты решётки спрайта БЕЗ его построения (issue #582): сторона, радиус очага,
 * запас силуэта. Про запас (`marginFor`) до этого знал только сам спрайт, а зона
 * очистки взрыва в `game-play.ts` считалась от `explosionRadius` — из-за чего кончики
 * лучей фугаса (35% радиуса) оставались на песке. Теперь габарит считается ОДНОЙ
 * функцией и для отрисовки, и для очистки.
 *
 * Экспортируется ради теста рядом (`explosion-sprite.test.ts`): вне модуля габарит
 * читает только `explosion-area.ts`, и ему хватает `explosionSpriteHalfWidth`.
 */
export type TExplosionSpriteMetrics = {
    /** Сторона решётки в ячейках (нечётная — центр ровно в середине). */
    size: number;
    /** Радиус залитого очага в ячейках (без запаса под лучи/обод/конус). */
    gridRadius: number;
    /** Целый масштаб ячейки в пиксели канваса. */
    scale: number;
    /** Половина стороны решётки в ячейках: очаг плюс запас силуэта. */
    half: number;
    /** Запас ячеек под выступающие детали силуэта (`marginFor`). */
    margin: number;
};

/**
 * Считает габариты решётки по силуэту и радиусу. Чистая функция без аллокаций —
 * её зовёт и `buildExplosionSprite` (рисование), и `explosion-area.ts` (очистка):
 * один источник правды вместо двух формул, которые уже разъезжались.
 *
 * Масштаб ячейки — не параметр, а константа модуля: пока он был необязательным
 * аргументом, очистка и отрисовка сходились лишь на общем ДЕФОЛТЕ, то есть
 * расхождение оставалось в одном аргументе от возвращения (ревью #601).
 */
export function explosionSpriteMetrics(
    silhouette: TExplosionSilhouette,
    radius: number,
): TExplosionSpriteMetrics {
    const s = EXPLOSION_PIXEL_SCALE;
    const gridRadius = Math.max(0, Math.floor(radius / s));
    const margin = radius <= 0 ? 0 : marginFor(silhouette, gridRadius);
    const half = gridRadius + margin;
    return { size: half * 2 + 1, gridRadius, scale: s, half, margin };
}

/**
 * Полугабарит НАРИСОВАННОГО спрайта в пикселях канваса по горизонтали: от центра
 * очага до самого дальнего залитого пикселя, с запасом на снап начала к целому
 * пикселю (`paintExplosionFocus` берёт `Math.floor(cx - half·scale)`).
 *
 * Откуда `half + 1`: решётка занимает `(2·half + 1)·scale` пикселей, её начало
 * сдвинуто снапом влево меньше чем на пиксель, поэтому правый край уходит от центра
 * не дальше `(half + 1)·scale`, а левый — не дальше `half·scale + 1`. Большая из
 * двух величин (`scale ≥ 1`) и есть общий полугабарит.
 */
export function explosionSpriteHalfWidth(silhouette: TExplosionSilhouette, radius: number): number {
    if (radius <= 0) return 0;
    const metrics = explosionSpriteMetrics(silhouette, radius);
    return (metrics.half + 1) * metrics.scale;
}

/**
 * Строит пиксельный спрайт кадра очага по силуэту и текущему радиусу вспышки.
 * Чистая детерминированная функция: одинаковый вход → побитово одинаковый спрайт
 * (критерий «два прогона одного сида дают одинаковый PNG», #542).
 */
export function buildExplosionSprite(
    silhouette: TExplosionSilhouette,
    radius: number,
): TExplosionSprite {
    const { size, gridRadius, scale: s, half, margin } = explosionSpriteMetrics(silhouette, radius);
    const levels = new Uint8Array(size * size);

    if (radius <= 0 || gridRadius === 0) {
        return { size, gridRadius, scale: s, levels };
    }

    const put = (col: number, row: number, level: number) => {
        if (level <= 0 || col < 0 || col >= size || row < 0 || row >= size) return;
        const capped = level > EXPLOSION_ALPHA_LEVELS ? EXPLOSION_ALPHA_LEVELS : level;
        const i = row * size + col;
        if (capped > levels[i]) levels[i] = capped;
    };

    // Нормировка «яркости»: ядро (метрика 0) — уровень 4, фронт (метрика gridRadius) —
    // уровень 1. `+1` в знаменателе не даёт фронту схлопнуться ровно в 0.
    const bandFromMetric = (metric: number) => quantize(1 - metric / (gridRadius + 1));

    for (let row = 0; row < size; row++) {
        const oy = row - half;
        for (let col = 0; col < size; col++) {
            const ox = col - half;

            switch (silhouette) {
                case 'burst':
                case 'cluster': {
                    // Круглый очаг: евклидов спад к фронту. Кластер — тот же круг (его
                    // «пятикратность» несут ПОСЛЕДОВАТЕЛЬНЫЕ очаги в бою, не форма одного).
                    const de = Math.hypot(ox, oy);
                    if (de <= gridRadius) put(col, row, bandFromMetric(de));
                    break;
                }
                case 'blast': {
                    // Мощный — ромб (манхэттенская метрика): силуэт заметно иной, чем круг.
                    const dm = Math.abs(ox) + Math.abs(oy);
                    if (dm <= gridRadius) put(col, row, bandFromMetric(dm));
                    // Обод ударной волны РОВНО в 1 ячейке за фронтом (критерий #542).
                    if (Math.round(Math.hypot(ox, oy)) === gridRadius + 1) put(col, row, 1);
                    break;
                }
                case 'digger': {
                    // Роющий — узкий конус ВНИЗ (apex снизу) плюс тонкий столб-фонтан вверх.
                    // Землистая техника, «не огонь»: форма читается как выброс грунта.
                    const depth = gridRadius + margin;
                    if (oy >= 0) {
                        const coneHalf = Math.max(
                            1,
                            Math.round((1 - oy / depth) * gridRadius * 0.6),
                        );
                        if (Math.abs(ox) <= coneHalf) put(col, row, bandFromMetric(oy));
                    } else if (Math.abs(ox) <= 1) {
                        put(col, row, 2);
                    }
                    break;
                }
            }
        }
    }

    // Лучи фугаса: 8 коротких спиц за фронт — отличают его от гладкого круга кластера.
    if (silhouette === 'burst') {
        const spoke = gridRadius + margin;
        const dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
        ];
        for (const [dx, dy] of dirs) {
            for (let r = 1; r <= spoke; r++) {
                put(half + dx * r, half + dy * r, 2);
            }
        }
    }

    return { size, gridRadius, scale: s, levels };
}
