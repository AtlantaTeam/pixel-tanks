/**
 * Геометрия тени танка и производная от неё зона частичной перерисовки (#580).
 *
 * ## Зачем отдельный модуль
 *
 * Тень рисует `Tank.drawShadow`, а стирает её перед следующим кадром
 * `GamePlay.redrawGroundUnderTanks` — два разных файла. Пока габарит тени и зона
 * очистки жили независимо (радиусы в `tank.ts`, литерал `padding = 50` в
 * `game-play.ts`), увеличение тени в #571 дало сразу три симптома одной причины
 * (#580): след за движущимся танком, накопление альфы под танком во время
 * осыпания земли после взрыва и — на закате — вырождение тени в чёрную полосу.
 *
 * Поэтому здесь **один источник**: зона очистки не подбирается числом, а
 * ВЫЧИСЛЯЕТСЯ вызовом той же функции геометрии, которой рисуется эллипс
 * (`tankShadowOverhangX` → `tankShadowGeometry`). Меняешь радиус тени — зона
 * едет за ним сама; развяжешь их обратно — падает тест
 * (`tank-shadow.test.ts` + интеграционный в `game-play.test.ts`), а не сцена.
 *
 * ## Почему высоты светила (dy) здесь нет
 *
 * #571 привязал полуширину и смещение к `dy`, и при низком светиле полуширина
 * доходила до 2.25 корпуса, а полувысота схлопывалась до 2 px. Пресет неба
 * выбирается сидом, то есть портился примерно каждый третий бой. Физически
 * длинная тень на закате правдоподобна, но в этом движке она обязана быть
 * сначала стираемой (см. выше) и лежащей на рельефе, а не горизонтальным
 * эллипсом. До переделки способа отрисовки геометрия зависит только от
 * ГОРИЗОНТАЛЬНОГО направления света — подпись функции высоты светила не
 * принимает вовсе, и это структурный барьер, а не подобранное число.
 */

/** Полуширина тени как доля ширины корпуса: тень ровно под корпусом. */
export const TANK_SHADOW_RADIUS_X_FRAC = 0.5;

/**
 * Модуль смещения тени как доля ширины корпуса при свете у горизонта
 * (`|dx| === 1`). Тень «выползает» из-под корпуса, не отрываясь от него.
 */
export const TANK_SHADOW_OFFSET_X_FRAC = 0.28;

/** Полувысота тени в мировых единицах: тонкий эллипс, тень, а не «клякса». */
export const TANK_SHADOW_RADIUS_Y_UNITS = 2;

/**
 * Исторический запас зоны перерисовки под декор корпуса — ствол и мачту флажка
 * ветра, которые выходят за габарит корпуса и стираются той же полосой. Тени не
 * касается: она добавляет к запасу свой вылет (`tankRedrawPaddingX`).
 */
export const TANK_DECOR_REDRAW_PADDING = 50;

/**
 * Запас поверх вылета тени: `drawShadow` округляет центр до целого пикселя
 * (`floor`) и упирает его в границы массива высот, плюс сглаживание эллипса
 * даёт полупрозрачную кромку в доли пикселя.
 */
const SHADOW_REDRAW_MARGIN = 2;

export type TTankShadowGeometryParams = {
    /** Координата середины корпуса по горизонтали (мировые пиксели). */
    centerX: number;
    /** Ширина корпуса с учётом масштаба мира. */
    tankWidth: number;
    /** Масштаб мира (`Tank.scale`) — им масштабируется полувысота. */
    scale: number;
    /** Горизонталь направления света (`TLightDirection['dx']`, −1..1). */
    lightDx: number;
};

export type TTankShadowGeometry = {
    /** Центр эллипса по горизонтали — середина корпуса плюс смещение по свету. */
    centerX: number;
    radiusX: number;
    radiusY: number;
};

/**
 * Эллипс тени: полуоси и центр по горизонтали. Чистая функция — тот же вход даёт
 * ту же геометрию и в рендере, и в расчёте зоны очистки.
 */
export function tankShadowGeometry({
    centerX,
    tankWidth,
    scale,
    lightDx,
}: TTankShadowGeometryParams): TTankShadowGeometry {
    return {
        centerX: centerX + lightDx * tankWidth * TANK_SHADOW_OFFSET_X_FRAC,
        radiusX: tankWidth * TANK_SHADOW_RADIUS_X_FRAC,
        radiusY: Math.max(TANK_SHADOW_RADIUS_Y_UNITS, TANK_SHADOW_RADIUS_Y_UNITS * scale),
    };
}

/**
 * На сколько тень выходит за габарит корпуса по горизонтали при САМОМ невыгодном
 * направлении света. Считается прогоном `tankShadowGeometry` по крайним `dx` —
 * не повторяет формулу радиусов, а зовёт её, поэтому не может от неё отстать.
 */
export function tankShadowOverhangX(tankWidth: number, scale: number): number {
    const hullCenterX = tankWidth / 2;
    let overhang = 0;
    for (const lightDx of [-1, 1]) {
        const { centerX, radiusX } = tankShadowGeometry({
            centerX: hullCenterX,
            tankWidth,
            scale,
            lightDx,
        });
        overhang = Math.max(overhang, -(centerX - radiusX), centerX + radiusX - tankWidth);
    }
    return Math.max(0, overhang);
}

/**
 * Горизонтальный запас зоны очистки вокруг корпуса: максимум из запаса на декор
 * и фактического вылета тени. Целые пиксели — `clearRect` по дробным координатам
 * оставляет полупрозрачную кромку прошлого кадра, а из неё и растёт накопление
 * альфы (симптом 3 в #580).
 */
export function tankRedrawPaddingX(tankWidth: number, scale: number): number {
    return Math.ceil(
        Math.max(
            TANK_DECOR_REDRAW_PADDING,
            tankShadowOverhangX(tankWidth, scale) + SHADOW_REDRAW_MARGIN,
        ),
    );
}
