import { EWeaponKind } from '@/shared/model';
import { ENGINE_COLORS } from './engine-palette';
import { GROUND_PARTICLE_COLORS } from './particle-pool';
import {
    buildExplosionSprite,
    EXPLOSION_ALPHA_LEVELS,
    type TExplosionSilhouette,
} from './explosion-sprite';

/**
 * Один очаг взрыва. Позиция — смещение по X от точки попадания в долях базового
 * радиуса взрыва (`WORLD_UNITS.explosionMaxRadius · scale`), радиус — множитель
 * того же базового радиуса. Одиночные типы имеют ровно один очаг в нуле; кластер —
 * три (центральный + два по бокам), которые Bullet отыгрывает последовательно.
 */
export type TWeaponFocus = {
    /** Смещение очага по X в долях базового радиуса взрыва. */
    dxFactor: number;
    /** Множитель максимального радиуса очага относительно базового. */
    radiusFactor: number;
};

/** Стопы радиального градиента взрыва (позиции 0 / 0.3 / 1 — общие для всех типов). */
export type TWeaponExplosionColors = {
    core: string;
    mid: string;
    edge: string;
};

/**
 * Спека одного типа оружия (issue #483). Различия типов — ТОЛЬКО числа и палитра
 * одной и той же формулы «растущий круг радиальным градиентом → кратер»: новых
 * подсистем эффектов нет, конечный автомат взрыва в `Bullet` один на все типы.
 * Спека разделяется по ссылке (`virtualFire` бота создаёт сотни снарядов за одно
 * прицеливание) и не участвует в горячем пути прицеливания.
 */
export type TWeaponSpec = {
    kind: EWeaponKind;
    /** Шаг роста `explosionRadius` за кадр. ЦЕЛЫЙ — дробный ломает кратер (`ground.fall`). */
    growthPerFrame: number;
    /** Стопы градиента взрыва. */
    colors: TWeaponExplosionColors;
    /** Множитель радиуса кратера (`ground.fall`) относительно `explosionRadius` очага. */
    craterRadiusFactor: number;
    /**
     * Смещение точки кратера вниз в долях `explosionRadius` очага. Глубина осыпания
     * в `Ground.renderLayer` зависит от `bulletY`, поэтому сдвиг вниз даёт глубокую
     * узкую воронку без новой физики (роющий).
     */
    craterYOffsetFactor: number;
    /** Комьев земли (`groundBurst`) на очаг. */
    groundBurstCount: number;
    /** Травма тряски при промахе (взрыв по земле) — на очаг. */
    shakeMiss: number;
    /** Травма тряски при прямом попадании в танк — разово. */
    shakeHit: number;
    /** Короткий slow-mo даже на промахе (мощный заряд). Попадание замедляет всегда. */
    slowMoOnMiss: boolean;
    /** Множитель размера квадрата снаряда в полёте. */
    bulletSizeFactor: number;
    /** Цвет квадрата снаряда; `null` — дефолтный чёрный (`Bullet`). */
    bulletColor: string | null;
    /** След снаряда: размер точки, время жизни (кадры), цвет. */
    trail: { size: number; life: number; color: string };
    /** Очаги взрыва (≥1). Больше одного — многоочаговый кластер. */
    foci: readonly TWeaponFocus[];
    /** Ударная волна — обод по самому фронту (`r = explosionRadius`), мощный заряд. */
    shockwave: boolean;
    /** Частицы узким столбом вместо широкого веера (роющий — выброс земли вверх). */
    groundColumn: boolean;
    /**
     * Силуэт пиксельной вспышки — подпись типа формой, а не цветом (issue #542).
     * Форма считается в `explosion-sprite.ts` и рисуется целыми пикселями, чтобы
     * взрыв читался в той же технике, что и остальная сцена.
     */
    silhouette: TExplosionSilhouette;
};

/** Единственный центральный очаг — для одиночных типов (не кластера). */
const SINGLE_FOCUS = (radiusFactor: number): readonly TWeaponFocus[] => [
    { dxFactor: 0, radiusFactor },
];

/**
 * Таблица спеков по типам (issue #483). **Числа фугаса заморожены** — это дефолтный
 * взрыв движка до задачи, ни одно значение не меняется (закреплено снапшот-тестом).
 * Остальные три — та же формула, отличия в числах и палитре стопов.
 */
export const WEAPON_SPECS: Record<EWeaponKind, TWeaponSpec> = {
    // ФУГАС — замороженный дефолт: стопы f37575/ff0000/571a1a, рост +1, кратер = радиус,
    // groundBurst 24, тряска 0.5/0.85, slow-mo только при попадании.
    [EWeaponKind.HighExplosive]: {
        kind: EWeaponKind.HighExplosive,
        growthPerFrame: 1,
        colors: { core: '#f37575ff', mid: '#ff0000ee', edge: '#571a1a55' },
        craterRadiusFactor: 1,
        craterYOffsetFactor: 0,
        groundBurstCount: 24,
        shakeMiss: 0.5,
        shakeHit: 0.85,
        slowMoOnMiss: false,
        bulletSizeFactor: 1,
        bulletColor: null,
        trail: { size: 3, life: 10, color: ENGINE_COLORS.primary },
        foci: SINGLE_FOCUS(1),
        shockwave: false,
        groundColumn: false,
        silhouette: 'burst',
    },
    // МОЩНЫЙ ЗАРЯД — крупнее и горячее: ядро ffe08a/ff5500, R_max ×1.4, рост +2 целым
    // (длится столько же кадров, но крупнее), кратер ×1.4 (от большего радиуса),
    // groundBurst 32, тряска 0.7/1.0, короткий slow-mo даже на промахе, ударная волна.
    [EWeaponKind.Heavy]: {
        kind: EWeaponKind.Heavy,
        growthPerFrame: 2,
        colors: { core: '#ffe08a', mid: '#ff5500ee', edge: '#571a1a55' },
        craterRadiusFactor: 1,
        craterYOffsetFactor: 0,
        groundBurstCount: 32,
        shakeMiss: 0.7,
        shakeHit: 1,
        slowMoOnMiss: true,
        bulletSizeFactor: 1.5,
        bulletColor: ENGINE_COLORS.danger,
        trail: { size: 4, life: 14, color: ENGINE_COLORS.danger },
        foci: SINGLE_FOCUS(1.4),
        shockwave: true,
        groundColumn: false,
        silhouette: 'blast',
    },
    // КЛАСТЕР — три последовательных очага тем же градиентом: центральный R×0.6, затем
    // два по ±0.8·R_фугаса, каждый R×0.45. groundBurst 9 на очаг, тряска 0.3 трижды,
    // след легче (size 2, life 6).
    [EWeaponKind.Cluster]: {
        kind: EWeaponKind.Cluster,
        growthPerFrame: 1,
        colors: { core: '#f37575ff', mid: '#ff0000ee', edge: '#571a1a55' },
        craterRadiusFactor: 1,
        craterYOffsetFactor: 0,
        groundBurstCount: 9,
        shakeMiss: 0.3,
        shakeHit: 0.3,
        slowMoOnMiss: false,
        bulletSizeFactor: 1,
        bulletColor: null,
        trail: { size: 2, life: 6, color: ENGINE_COLORS.primary },
        foci: [
            { dxFactor: 0, radiusFactor: 0.6 },
            { dxFactor: -0.8, radiusFactor: 0.45 },
            { dxFactor: 0.8, radiusFactor: 0.45 },
        ],
        shockwave: false,
        groundColumn: false,
        silhouette: 'cluster',
    },
    // РОЮЩИЙ — визуально мал (R×0.5) в палитре грунта e8b06a/a35a2a/6b3f1d: читается
    // как выброс земли, не огонь. Глубина через сдвиг кратера вниз (y + 0.5·R,
    // radius 0.9·R) — узкая глубокая воронка. Частицы узким столбом, тряска 0.4, без slow-mo.
    [EWeaponKind.Digger]: {
        kind: EWeaponKind.Digger,
        growthPerFrame: 1,
        colors: { core: '#e8b06a', mid: '#a35a2acc', edge: '#6b3f1d55' },
        craterRadiusFactor: 0.9,
        craterYOffsetFactor: 0.5,
        groundBurstCount: 12,
        shakeMiss: 0.4,
        shakeHit: 0.4,
        slowMoOnMiss: false,
        bulletSizeFactor: 1,
        bulletColor: null,
        trail: { size: 3, life: 10, color: GROUND_PARTICLE_COLORS[1] },
        foci: SINGLE_FOCUS(0.5),
        shockwave: false,
        groundColumn: true,
        silhouette: 'digger',
    },
};

/**
 * Спека по типу. `WEAPON_SPECS` — тотальный `Record<EWeaponKind, TWeaponSpec>`, а
 * декодер реплея клампит `weaponId` в `WEAPON_KIND_ORDER`, поэтому невалидный `kind`
 * сюда не приходит и `??`-ветка недостижима штатно. Фолбэк оставлен как страховка
 * ТОЛЬКО на невалидный рантайм-каст извне системы типов (например, `kind` из
 * непроверенного JSON, приведённый к `EWeaponKind`) — тогда вернётся фугас.
 */
export const weaponSpecFor = (kind: EWeaponKind): TWeaponSpec =>
    WEAPON_SPECS[kind] ?? WEAPON_SPECS[EWeaponKind.HighExplosive];

/**
 * Альфа четырёх уровней спрайта (index = уровень 1..4). Ровно 4 значения у края —
 * квантование вместо плавного затухания убирает «мыло» (критерий #542). Альфа несётся
 * ТОЛЬКО этим ramp'ом (`globalAlpha`), а не альфой в hex палитры, — иначе перемножение
 * дало бы больше 4 значений; поэтому цвет берётся без альфа-канала (`stripAlpha`).
 */
const LEVEL_ALPHA = [0, 0.35, 0.55, 0.78, 1] as const;

/** Отбрасывает альфа-канал у `#rrggbb(aa)` — оставляет непрозрачный `#rrggbb`. */
function stripAlpha(hex: string): string {
    return hex.length >= 7 ? hex.slice(0, 7) : hex;
}

/** Цвет ячейки по уровню: ядро (4) → середина (3–2) → фронт (1). Радиальные зоны. */
function colorForLevel(level: number, colors: TWeaponExplosionColors): string {
    if (level >= EXPLOSION_ALPHA_LEVELS) return stripAlpha(colors.core);
    if (level >= 2) return stripAlpha(colors.mid);
    return stripAlpha(colors.edge);
}

/**
 * Рисует один кадр очага взрыва ПИКСЕЛЬНОЙ техникой (issue #542): силуэт считается в
 * низком разрешении (`explosion-sprite.ts`) и заливается целыми квадратами `S×S` без
 * сглаживания — та же ступенчатая техника, что у облаков и гор сцены, вместо мягкого
 * градиента, из-за которого взрыв читался «в другой технике» и «так себе».
 *
 * Силуэт — подпись типа формой (круг с лучами / ромб с ободом / круг очага / конус
 * вниз), а не только цветом: палитра занята семантикой и на закате не читается.
 * Единый примитив для боевого `Bullet.drawExplosion` и витрины (`ui/weapon-fx-demo`).
 *
 * Заливка батчится по уровню альфы: один `fillStyle`/`globalAlpha` на уровень, ≤4
 * прохода — у края вспышки не больше 4 значений альфы (критерий #542).
 */
export function paintExplosionFocus(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    colors: TWeaponExplosionColors,
    silhouette: TExplosionSilhouette,
): void {
    if (radius <= 0) return;

    const sprite = buildExplosionSprite(silhouette, radius);
    const { size, scale, levels } = sprite;
    const half = (size - 1) / 2;
    // Снап начала к целым пикселям канваса — крестики сетки без субпиксельного «мыла».
    const originX = Math.floor(cx - half * scale);
    const originY = Math.floor(cy - half * scale);

    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    // Контракт техники: без сглаживания (на fillRect не влияет, но фиксирует намерение).
    ctx.imageSmoothingEnabled = false;

    for (let level = 1; level <= EXPLOSION_ALPHA_LEVELS; level++) {
        ctx.globalAlpha = LEVEL_ALPHA[level];
        ctx.fillStyle = colorForLevel(level, colors);
        for (let row = 0; row < size; row++) {
            const base = row * size;
            for (let col = 0; col < size; col++) {
                if (levels[base + col] !== level) continue;
                ctx.fillRect(originX + col * scale, originY + row * scale, scale, scale);
            }
        }
    }

    ctx.globalAlpha = prevAlpha;
    ctx.imageSmoothingEnabled = prevSmoothing;
}
