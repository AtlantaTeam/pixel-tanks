import { EWeaponKind } from '@/shared/model';
import { ENGINE_COLORS } from './engine-palette';
import { GROUND_PARTICLE_COLORS } from './particle-pool';

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
    },
};

/** Спека по типу; неизвестный тип (не должен возникать) — фугас как безопасный дефолт. */
export const weaponSpecFor = (kind: EWeaponKind): TWeaponSpec =>
    WEAPON_SPECS[kind] ?? WEAPON_SPECS[EWeaponKind.HighExplosive];

/**
 * Рисует один кадр очага взрыва: радиальный градиент от ядра до `radius` плюс, для
 * ударной волны, тонкий обод РОВНО по фронту (`r = radius`, не впереди — критерий
 * #483). Единый примитив для боевого `Bullet.drawExplosion` и витрины
 * (`ui/weapon-fx-demo`): вид взрыва задаётся тут в одном месте, а не дублируется.
 */
export function paintExplosionFocus(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    colors: TWeaponExplosionColors,
    shockwave: boolean,
): void {
    const gradient = ctx.createRadialGradient(cx, cy, radius / 10, cx, cy, radius + radius / 2);
    gradient.addColorStop(0, colors.core);
    gradient.addColorStop(0.3, colors.mid);
    gradient.addColorStop(1, colors.edge);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI, true);
    ctx.fill();
    ctx.closePath();

    if (shockwave && radius > 0) {
        ctx.strokeStyle = colors.core;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI, true);
        ctx.stroke();
        ctx.closePath();
    }
}
