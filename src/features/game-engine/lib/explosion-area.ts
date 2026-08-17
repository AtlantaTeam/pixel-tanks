/**
 * Полоса сцены, которую занимает взрыв, — один диапазон на всю точечную
 * перерисовку (issue #582).
 *
 * ## Зачем отдельный модуль
 *
 * `GamePlay.explosionAreaRedraw` чистил и перерисовывал сцену тремя РАЗНЫМИ
 * выражениями: `clearRect` брал `[x − r − 5 … x + r + 5]`, `ground.draw` —
 * `[x − r − 5 … x + 2r + 5]` (ширина, переданная как координата правого края), а
 * фактический габарит спрайта вспышки не совпадал ни с одним из них, потому что
 * про запас силуэта (`marginFor`, у фугаса — 35% радиуса) знал только сам спрайт.
 * Наружу это выходило двумя видами грязи на песке: оторванные кончики лучей рядом
 * с очагом и вертикальные ленты песка другого тона с резкой границей (двойная
 * отрисовка рельефа поверх неочищенного).
 *
 * Поэтому здесь **одна пара координат** на всё: и очистка, и рельеф, и клип
 * призрачной трассы считаются из `explosionRedrawRange`. Расхождение стало
 * невозможным структурно, а не «поправленным на 5 пикселей».
 *
 * ## Почему полоса статична на весь взрыв
 *
 * Диапазон считается по ПИКОВОМУ радиусу очага, а не по текущему
 * `explosionRadius`, и объединяет ВСЕ очаги спеки. Иначе полоса дышала бы вместе
 * со вспышкой, а у кластера ещё и прыгала бы за смещённым очагом
 * (`explosionCenterX = x + dxFactor · baseRadius`, до ±0.8 базового радиуса):
 * кадр за кадром она оставляла бы за собой неочищенные куски предыдущего кадра —
 * ровно ту грязь, ради которой всё и затевалось.
 */

import { explosionSpriteHalfWidth } from './explosion-sprite';
import type { TWeaponSpec } from './weapon-specs';

/** Горизонтальная полоса сцены в CSS-пикселях: `from` включительно, `to` — правый край. */
export type TExplosionRedrawRange = {
    from: number;
    to: number;
};

export type TExplosionRedrawParams = {
    /** Точка попадания снаряда (`bullet.x`) — от неё отсчитываются смещения очагов. */
    hitX: number;
    /** Базовый радиус взрыва (`WORLD_UNITS.explosionMaxRadius · scale`). */
    baseRadius: number;
    /** Спека оружия: очаги (смещение и множитель радиуса), силуэт, воронка. */
    spec: TWeaponSpec;
};

/**
 * Запас на снап центра воронки к целому столбцу рельефа: `ground.fall` берёт
 * `floor(cx)` и метит столбцы `[x − radius … x + radius]` включительно.
 */
const CRATER_SNAP_MARGIN = 1;

/**
 * Наибольший радиус, до которого дорастает очаг: рост идёт целыми шагами
 * `growthPerFrame`, поэтому последний кадр перед воронкой перешагивает максимум
 * очага почти на целый шаг. Верхняя оценка — по ней и считаются габариты.
 */
function peakRadiusOf(radiusFactor: number, baseRadius: number, growthPerFrame: number): number {
    return radiusFactor * baseRadius + Math.max(0, growthPerFrame);
}

/**
 * Насколько далеко от центра очага взрыв меняет пиксели: вспышка (габарит спрайта
 * с запасом силуэта) или воронка (`craterRadiusFactor` от того же пикового радиуса)
 * — что дальше. Рельеф считается вместе со вспышкой не для симметрии: `ground.draw`
 * блитит слой только внутри запрошенной полосы, и край воронки за её пределами
 * остался бы старым до следующего полного перерисова.
 */
function focusReach(spec: TWeaponSpec, radiusFactor: number, baseRadius: number): number {
    const peak = peakRadiusOf(radiusFactor, baseRadius, spec.growthPerFrame);
    const sprite = explosionSpriteHalfWidth(spec.silhouette, peak);
    const crater = spec.craterRadiusFactor * peak + CRATER_SNAP_MARGIN;
    return Math.max(sprite, crater);
}

/**
 * Полоса сцены под весь взрыв снаряда: объединение габаритов всех очагов спеки на
 * пиковом радиусе. Границы целые — `clearRect` по дробным координатам оставляет
 * полупрозрачную кромку прошлого кадра (тот же класс, что накопление альфы под
 * танком в #580).
 */
export function explosionRedrawRange({
    hitX,
    baseRadius,
    spec,
}: TExplosionRedrawParams): TExplosionRedrawRange {
    let from = Infinity;
    let to = -Infinity;
    for (const focus of spec.foci) {
        const centerX = hitX + focus.dxFactor * baseRadius;
        const reach = focusReach(spec, focus.radiusFactor, baseRadius);
        from = Math.min(from, centerX - reach);
        to = Math.max(to, centerX + reach);
    }
    // Спека без очагов невозможна по типу (`foci: ≥1`), но пустой список дал бы
    // здесь ±Infinity и `clearRect` во всю сцену — вырождаем в пустую полосу.
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { from: hitX, to: hitX };
    return { from: Math.floor(from), to: Math.ceil(to) };
}
