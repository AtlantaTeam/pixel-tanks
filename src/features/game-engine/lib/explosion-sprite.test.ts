import {
    buildExplosionSprite,
    EXPLOSION_ALPHA_LEVELS,
    EXPLOSION_PIXEL_SCALE,
    explosionSpriteHalfWidth,
    type TExplosionSilhouette,
} from './explosion-sprite';

const SILHOUETTES: TExplosionSilhouette[] = ['burst', 'blast', 'cluster', 'digger'];

/** Индекс ячейки решётки по смещению от центра (для точечных проверок формы). */
function levelAt(sprite: ReturnType<typeof buildExplosionSprite>, ox: number, oy: number): number {
    const half = (sprite.size - 1) / 2;
    const col = half + ox;
    const row = half + oy;
    if (col < 0 || col >= sprite.size || row < 0 || row >= sprite.size) return 0;
    return sprite.levels[row * sprite.size + col];
}

/** Число залитых ячеек (уровень > 0). */
function filledCount(sprite: ReturnType<typeof buildExplosionSprite>): number {
    let n = 0;
    for (const v of sprite.levels) if (v > 0) n += 1;
    return n;
}

describe('buildExplosionSprite — пиксельная техника (issue #542)', () => {
    it('масштаб ячейки целый', () => {
        expect(Number.isInteger(EXPLOSION_PIXEL_SCALE)).toBe(true);
        for (const s of SILHOUETTES) {
            const sprite = buildExplosionSprite(s, 30);
            expect(Number.isInteger(sprite.scale)).toBe(true);
            expect(sprite.scale).toBe(EXPLOSION_PIXEL_SCALE);
        }
    });

    it('у края вспышки не больше 4 значений альфы', () => {
        for (const s of SILHOUETTES) {
            const sprite = buildExplosionSprite(s, 40);
            const distinct = new Set<number>();
            for (const v of sprite.levels) if (v > 0) distinct.add(v);
            expect(distinct.size).toBeLessThanOrEqual(EXPLOSION_ALPHA_LEVELS);
            for (const v of distinct) {
                expect(v).toBeGreaterThanOrEqual(1);
                expect(v).toBeLessThanOrEqual(EXPLOSION_ALPHA_LEVELS);
            }
        }
    });

    it('нулевой и отрицательный радиус — пустой спрайт (ничего не рисуем)', () => {
        for (const s of SILHOUETTES) {
            expect(filledCount(buildExplosionSprite(s, 0))).toBe(0);
            expect(filledCount(buildExplosionSprite(s, -5))).toBe(0);
        }
    });

    // Критерий #542: «два прогона одного сида дают побитово одинаковый PNG». Функция
    // чистая — тот же вход обязан дать тот же массив ячеек, без Math.random внутри.
    it('детерминизм: одинаковый вход → побитово одинаковый спрайт', () => {
        for (const s of SILHOUETTES) {
            const a = buildExplosionSprite(s, 37);
            const b = buildExplosionSprite(s, 37);
            expect(Array.from(a.levels)).toEqual(Array.from(b.levels));
            expect(a.size).toBe(b.size);
        }
    });

    // Критерий #542: «стоп-кадр на 50%, четыре типа рядом, ч/б — типы различимы без
    // цвета». Тест-плашка: строим силуэты одного радиуса и проверяем, что форма (не
    // палитра) у каждого типа своя. Радиус подобран так, чтобы спрайты влезали в 64×64.
    describe('силуэты различимы без цвета (ч/б, стоп-кадр 50%)', () => {
        const RADIUS = 27; // gridRadius ~9 → спрайты заведомо меньше 64×64
        const sprites = Object.fromEntries(
            SILHOUETTES.map((s) => [s, buildExplosionSprite(s, RADIUS)]),
        ) as Record<TExplosionSilhouette, ReturnType<typeof buildExplosionSprite>>;

        it('все четыре спрайта помещаются в тест-плашку 64×64', () => {
            for (const s of SILHOUETTES) {
                expect(sprites[s].size).toBeLessThanOrEqual(64);
            }
        });

        it('фугас: есть лучи за фронтом — залитые ячейки дальше радиуса очага', () => {
            const { gridRadius } = sprites.burst;
            // Ячейка строго за радиусом по оси (луч) залита.
            expect(levelAt(sprites.burst, gridRadius + 1, 0)).toBeGreaterThan(0);
        });

        it('кластер: гладкий круг — лучей за фронтом НЕТ (отличие от фугаса)', () => {
            const { gridRadius } = sprites.cluster;
            expect(levelAt(sprites.cluster, gridRadius + 1, 0)).toBe(0);
            expect(levelAt(sprites.cluster, gridRadius + 2, 0)).toBe(0);
        });

        it('мощный: ромб — диагональ середины пуста там, где у круга залито', () => {
            const { gridRadius } = sprites.blast;
            const d = Math.round(gridRadius * 0.7);
            // Круг (фугас/кластер) на 45° внутри фронта — залит; ромб — пуст.
            expect(levelAt(sprites.cluster, d, d)).toBeGreaterThan(0);
            expect(levelAt(sprites.blast, d, d)).toBe(0);
        });

        it('роющий: вертикально асимметричен (конус вниз + столб вверх)', () => {
            const sprite = sprites.digger;
            const half = (sprite.size - 1) / 2;
            let top = 0;
            let bottom = 0;
            for (let row = 0; row < sprite.size; row++) {
                for (let col = 0; col < sprite.size; col++) {
                    if (sprite.levels[row * sprite.size + col] === 0) continue;
                    if (row < half) top += 1;
                    else if (row > half) bottom += 1;
                }
            }
            // Круг/ромб симметричны сверху/снизу; роющий — нет.
            expect(Math.abs(top - bottom)).toBeGreaterThan(2);
        });

        it('симметричные типы вертикально симметричны (контраст с роющим)', () => {
            for (const s of ['burst', 'blast', 'cluster'] as const) {
                const sprite = sprites[s];
                const half = (sprite.size - 1) / 2;
                let top = 0;
                let bottom = 0;
                for (let row = 0; row < sprite.size; row++) {
                    for (let col = 0; col < sprite.size; col++) {
                        if (sprite.levels[row * sprite.size + col] === 0) continue;
                        if (row < half) top += 1;
                        else if (row > half) bottom += 1;
                    }
                }
                expect(top).toBe(bottom);
            }
        });

        it('никакая пара силуэтов не даёт идентичную маску', () => {
            for (let i = 0; i < SILHOUETTES.length; i++) {
                for (let j = i + 1; j < SILHOUETTES.length; j++) {
                    const a = sprites[SILHOUETTES[i]];
                    const b = sprites[SILHOUETTES[j]];
                    const sameShape =
                        a.size === b.size &&
                        Array.from(a.levels).every((v, k) => v === b.levels[k]);
                    expect(sameShape).toBe(false);
                }
            }
        });
    });
});

/**
 * Габарит спрайта отдельно от самого спрайта (issue #582). До этой задачи про запас
 * силуэта (`marginFor`) знал только `buildExplosionSprite`, а зона очистки взрыва
 * считалась от `explosionRadius` — и кончики лучей фугаса (35% радиуса) оставались
 * на песке. Тесты сторожат САМУ СВЯЗЬ: габарит выведен из тех же чисел, что решётка.
 */
describe('explosionSpriteHalfWidth — габарит спрайта без его построения (issue #582)', () => {
    it('габарит выведен из ТОЙ ЖЕ решётки, что и построенный спрайт', () => {
        // Проверяем связь через публичную пару, а не через внутренние метрики: сам
        // `explosionSpriteMetrics` наружу не торчит намеренно (ревью #601) — иначе
        // следующий вызывающий возьмёт метрики и снова разведёт две формулы габарита,
        // ради устранения которых модуль и появился.
        for (const s of SILHOUETTES) {
            for (const radius of [1, 7, 33.75, 45, 75, 106]) {
                const sprite = buildExplosionSprite(s, radius);
                const half = (sprite.size - 1) / 2;
                expect(explosionSpriteHalfWidth(s, radius)).toBe((half + 1) * sprite.scale);
            }
        }
    });

    it('полугабарит покрывает всю решётку со снапом начала к целому пикселю', () => {
        for (const s of SILHOUETTES) {
            for (const radius of [4, 20, 50, 75]) {
                const sprite = buildExplosionSprite(s, radius);
                const half = (sprite.size - 1) / 2;
                const width = explosionSpriteHalfWidth(s, radius);
                // Так же, как рисует `paintExplosionFocus`, но при дробном центре —
                // именно на нём снап `floor` и уводит спрайт влево.
                for (const cx of [100, 100.5, 100.9]) {
                    const originX = Math.floor(cx - half * sprite.scale);
                    expect(originX).toBeGreaterThanOrEqual(cx - width);
                    expect(originX + sprite.size * sprite.scale).toBeLessThanOrEqual(cx + width);
                }
            }
        }
    });

    it('запас силуэта учтён: у фугаса габарит больше радиуса вспышки', () => {
        // Лучи фугаса — 35% радиуса; зона в 5 px вокруг радиуса их не покрывала.
        expect(explosionSpriteHalfWidth('burst', 75)).toBeGreaterThan(75 + 5);
        // У кластера запаса нет вовсе — габарит близок к радиусу, но не меньше него.
        expect(explosionSpriteHalfWidth('cluster', 75)).toBeGreaterThanOrEqual(75);
    });

    it('габарит не меньше радиуса ни на одном силуэте и радиусе', () => {
        for (const s of SILHOUETTES) {
            for (let radius = 1; radius <= 120; radius += 1) {
                expect(explosionSpriteHalfWidth(s, radius)).toBeGreaterThanOrEqual(radius);
            }
        }
    });

    it('пустой взрыв — нулевой габарит (чистить нечего)', () => {
        for (const s of SILHOUETTES) {
            expect(explosionSpriteHalfWidth(s, 0)).toBe(0);
            expect(explosionSpriteHalfWidth(s, -3)).toBe(0);
        }
    });
});
