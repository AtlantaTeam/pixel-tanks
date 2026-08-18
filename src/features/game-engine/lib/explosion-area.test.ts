import { describe, expect, it } from 'vitest';
import { explosionRedrawRange } from './explosion-area';
import { paintExplosionFocus, WEAPON_SPECS, type TWeaponSpec } from './weapon-specs';
import { WORLD_SCALE_MAX, WORLD_SCALE_MIN, WORLD_UNITS } from './world-scale';
import { EWeaponKind } from '@/shared/model';

/**
 * Зона перерисовки взрыва (issue #582). После взрыва на песке оставались обрывки
 * лучей (очистка не знала про запас силуэта) и вертикальные ленты песка другого
 * тона (`clearRect` и `ground.draw` расходились на радиус справа). Тесты ниже
 * сторожат ПОКРЫТИЕ: всё, что взрыв рисует и роет, обязано лежать внутри одной
 * полосы, которую движок чистит и перерисовывает.
 */

/** Все типы оружия из таблицы спеков — перебираем каждый, а не один любимый. */
const KINDS = Object.keys(WEAPON_SPECS) as EWeaponKind[];

/**
 * Боевые масштабы мира: канон (1) и НАСТОЯЩИЕ края диапазона ресайза —
 * `WORLD_SCALE_MIN`/`WORLD_SCALE_MAX` из `world-scale.ts` (ревью #601: прежний
 * список подписывался краями, но брал 0.6 и 2.2 — минимум не покрыт, максимум
 * недостижим). Последнее значение — запас на вырост, заведомо выше потолка: полоса
 * обязана покрывать вспышку и там, куда мир пока не растягивается.
 */
const SCALES = [WORLD_SCALE_MIN, 1, WORLD_SCALE_MAX, 2.2];

const baseRadiusFor = (scale: number) => WORLD_UNITS.explosionMaxRadius * scale;

/** Потолок кадров роста одного очага — страховка от бесконечного цикла в модели. */
const GROWTH_FRAMES_GUARD = 500;

/** Журнал заливок: `paintExplosionFocus` рисует спрайт целыми квадратами. */
class PaintLogCtx {
    fillStyle = '';
    globalAlpha = 1;
    imageSmoothingEnabled = true;
    rects: number[][] = [];

    fillRect(x: number, y: number, w: number, h: number) {
        this.rects.push([x, y, w, h]);
    }
}

/**
 * Прогоняет весь взрыв кадр за кадром, как это делает `Bullet.drawExplosion`:
 * очаг за очагом, радиус растёт шагами `growthPerFrame` до максимума очага.
 * Возвращает крайние координаты по горизонтали среди ВСЕХ нарисованных пикселей
 * и всех столбцов, задетых воронкой (`ground.fall`).
 *
 * **Это МОДЕЛЬ автомата взрыва, и она обязана следовать за движком.** Цикл роста,
 * порядок «нарисовать → инкремент → воронка по инкрементированному радиусу» и
 * формула `craterRadius` списаны с `Bullet.drawExplosion`: поправят автомат там —
 * этот тест продолжит сторожить старую модель и останется зелёным. Настоящий
 * `Bullet` гоняет интеграционный тест в `game-play.test.ts`; здесь модель нужна,
 * чтобы собрать габарит вспышки БЕЗ канваса и земли (ревью #601).
 */
function paintWholeExplosion(spec: TWeaponSpec, hitX: number, baseRadius: number) {
    const ctx = new PaintLogCtx();
    let left = Infinity;
    let right = -Infinity;
    for (const focus of spec.foci) {
        const centerX = hitX + focus.dxFactor * baseRadius;
        const maxRadius = focus.radiusFactor * baseRadius;
        let radius = 0;
        let frames = 0;
        for (; frames < GROWTH_FRAMES_GUARD; frames += 1) {
            ctx.rects.length = 0;
            paintExplosionFocus(
                ctx as unknown as CanvasRenderingContext2D,
                centerX,
                200,
                radius,
                spec.colors,
                spec.silhouette,
            );
            for (const [x, , w] of ctx.rects) {
                left = Math.min(left, x);
                right = Math.max(right, x + w);
            }
            radius += spec.growthPerFrame;
            if (radius >= maxRadius) break;
        }
        // Гвард исчерпался — очаг обойдён не целиком, и все выводы ниже про четверть
        // взрыва. Без этой проверки тест молча вырождался бы в частичный обход.
        if (frames >= GROWTH_FRAMES_GUARD) {
            throw new Error(
                `очаг не дорос за ${GROWTH_FRAMES_GUARD} кадров: radius=${radius}, max=${maxRadius}`,
            );
        }
        // Воронка режется на том же кадре, где радиус перешагнул максимум очага.
        const craterRadius = Math.floor(spec.craterRadiusFactor * radius);
        left = Math.min(left, Math.floor(centerX) - craterRadius);
        right = Math.max(right, Math.floor(centerX) + craterRadius);
    }
    return { left, right };
}

describe('explosionRedrawRange — одна полоса на весь взрыв (issue #582)', () => {
    it('в переборе типов участвуют все четыре спеки (гвард от пустого it.each)', () => {
        expect(KINDS).toHaveLength(4);
    });

    it.each(KINDS)(
        '%s: вся вспышка и вся воронка лежат внутри полосы на всех масштабах мира',
        (kind) => {
            const spec = WEAPON_SPECS[kind];
            for (const scale of SCALES) {
                const baseRadius = baseRadiusFor(scale);
                const hitX = 400;
                const { from, to } = explosionRedrawRange({ hitX, baseRadius, spec });
                const { left, right } = paintWholeExplosion(spec, hitX, baseRadius);

                // Гвард от вырождения: ничего не нарисовалось — тест сторожил бы пустоту.
                expect(Number.isFinite(left) && Number.isFinite(right)).toBe(true);
                expect(right).toBeGreaterThan(left);

                expect(
                    from,
                    `масштаб ${scale}: левый край полосы правее вспышки`,
                ).toBeLessThanOrEqual(left);
                expect(
                    to,
                    `масштаб ${scale}: правый край полосы левее вспышки`,
                ).toBeGreaterThanOrEqual(right);
            }
        },
    );

    it('кластер: смещённые очаги остаются внутри полосы при максимальном dxFactor', () => {
        const spec = WEAPON_SPECS[EWeaponKind.Cluster];
        const baseRadius = baseRadiusFor(1);
        const hitX = 300;
        const { from, to } = explosionRedrawRange({ hitX, baseRadius, spec });

        const offsets = spec.foci.map((f) => f.dxFactor);
        // Гвард: спека обязана иметь реально смещённые очаги, иначе тест пустой.
        expect(Math.max(...offsets.map(Math.abs))).toBeGreaterThan(0.5);

        for (const focus of spec.foci) {
            const centerX = hitX + focus.dxFactor * baseRadius;
            expect(centerX).toBeGreaterThan(from);
            expect(centerX).toBeLessThan(to);
        }
    });

    it('полоса шире, чем «радиус плюс 5 px», — запас силуэта фугаса учтён', () => {
        const spec = WEAPON_SPECS[EWeaponKind.HighExplosive];
        const baseRadius = baseRadiusFor(1.5);
        const { from, to } = explosionRedrawRange({ hitX: 500, baseRadius, spec });
        // Прежняя формула: [x − r − 5 … x + r + 5]. Она и оставляла кончики лучей.
        expect(from).toBeLessThan(500 - baseRadius - 5);
        expect(to).toBeGreaterThan(500 + baseRadius + 5);
    });

    it('границы целые — дробный clearRect оставляет полупрозрачную кромку', () => {
        for (const kind of KINDS) {
            const { from, to } = explosionRedrawRange({
                hitX: 123.45,
                baseRadius: baseRadiusFor(1.37),
                spec: WEAPON_SPECS[kind],
            });
            expect(Number.isInteger(from)).toBe(true);
            expect(Number.isInteger(to)).toBe(true);
        }
    });

    it('полоса симметрична вокруг попадания у одноочаговых типов', () => {
        for (const kind of [EWeaponKind.HighExplosive, EWeaponKind.Heavy, EWeaponKind.Digger]) {
            const hitX = 640;
            const { from, to } = explosionRedrawRange({
                hitX,
                baseRadius: baseRadiusFor(1),
                spec: WEAPON_SPECS[kind],
            });
            expect(hitX - from).toBe(to - hitX);
        }
    });

    it('спека без очагов не превращается в очистку всей сцены', () => {
        const spec = { ...WEAPON_SPECS[EWeaponKind.HighExplosive], foci: [] };
        expect(explosionRedrawRange({ hitX: 42, baseRadius: 75, spec })).toEqual({
            from: 42,
            to: 42,
        });
    });
});
