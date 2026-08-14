import { EWeaponKind, WEAPON_KIND_ORDER } from '@/shared/model';
import { ENGINE_COLORS } from './engine-palette';
import { WEAPON_SPECS, weaponSpecFor, type TWeaponSpec } from './weapon-specs';

describe('WEAPON_SPECS', () => {
    it('покрывает все четыре типа', () => {
        for (const kind of WEAPON_KIND_ORDER) {
            expect(WEAPON_SPECS[kind]).toBeDefined();
            expect(WEAPON_SPECS[kind].kind).toBe(kind);
        }
    });

    // Снапшот на спек (критерий #483): числа фугаса — замороженный дефолт движка.
    // Любая правка этих значений обязана краснить тест — это барьер, а не устная
    // договорённость. Стопы, рост, кратер, groundBurst, тряска, slow-mo — всё канон.
    it('фугас: числа заморожены дословно', () => {
        const highExplosive: TWeaponSpec = {
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
            foci: [{ dxFactor: 0, radiusFactor: 1 }],
            groundColumn: false,
            silhouette: 'burst',
        };
        expect(WEAPON_SPECS[EWeaponKind.HighExplosive]).toEqual(highExplosive);
    });

    it('мощный заряд крупнее и импульснее фугаса', () => {
        const heavy = WEAPON_SPECS[EWeaponKind.Heavy];
        const base = WEAPON_SPECS[EWeaponKind.HighExplosive];
        expect(heavy.foci[0].radiusFactor).toBeGreaterThan(base.foci[0].radiusFactor);
        expect(heavy.growthPerFrame).toBeGreaterThan(base.growthPerFrame);
        expect(heavy.shakeHit).toBeGreaterThan(base.shakeHit);
        expect(heavy.slowMoOnMiss).toBe(true);
        expect(heavy.bulletSizeFactor).toBeGreaterThan(1);
    });

    it('кластер дробится на три очага', () => {
        const cluster = WEAPON_SPECS[EWeaponKind.Cluster];
        expect(cluster.foci).toHaveLength(3);
        // Центральный очаг в нуле, боковые — симметрично по X.
        expect(cluster.foci[0].dxFactor).toBe(0);
        expect(cluster.foci[1].dxFactor).toBe(-cluster.foci[2].dxFactor);
    });

    it('роющий копает вниз узким столбом', () => {
        const digger = WEAPON_SPECS[EWeaponKind.Digger];
        expect(digger.craterYOffsetFactor).toBeGreaterThan(0);
        expect(digger.foci[0].radiusFactor).toBeLessThan(1);
        expect(digger.groundColumn).toBe(true);
        expect(digger.slowMoOnMiss).toBe(false);
    });

    it('весь рост — целый (дробный ломает ground.fall)', () => {
        for (const kind of WEAPON_KIND_ORDER) {
            expect(Number.isInteger(WEAPON_SPECS[kind].growthPerFrame)).toBe(true);
        }
    });

    it('weaponSpecFor отдаёт спеку по типу', () => {
        expect(weaponSpecFor(EWeaponKind.Cluster)).toBe(WEAPON_SPECS[EWeaponKind.Cluster]);
    });

    it('каждый тип несёт свой силуэт вспышки (подпись типа формой, #542)', () => {
        const byKind = {
            [EWeaponKind.HighExplosive]: 'burst',
            [EWeaponKind.Heavy]: 'blast',
            [EWeaponKind.Cluster]: 'cluster',
            [EWeaponKind.Digger]: 'digger',
        } as const;
        const silhouettes = WEAPON_KIND_ORDER.map((k) => WEAPON_SPECS[k].silhouette);
        // Все четыре силуэта разные — иначе типы сливаются формой.
        expect(new Set(silhouettes).size).toBe(WEAPON_KIND_ORDER.length);
        for (const kind of WEAPON_KIND_ORDER) {
            expect(WEAPON_SPECS[kind].silhouette).toBe(byKind[kind]);
        }
    });

    // Критерий #542: «через секунду после попадания — четыре разных профиля кратера».
    // Профиль кратера задают: число очагов, радиус (`craterRadiusFactor` × макс. радиус
    // очага `radiusFactor`) и глубина (`craterYOffsetFactor`). Проверяем, что у всех
    // четырёх типов эта подпись различна.
    it('четыре разных профиля кратера', () => {
        const profileOf = (kind: EWeaponKind) => {
            const s = WEAPON_SPECS[kind];
            const maxFocusRadius = Math.max(...s.foci.map((f) => f.radiusFactor));
            return [
                s.foci.length,
                Math.round(s.craterRadiusFactor * maxFocusRadius * 100) / 100,
                s.craterYOffsetFactor,
            ].join(':');
        };
        const profiles = WEAPON_KIND_ORDER.map(profileOf);
        expect(new Set(profiles).size).toBe(WEAPON_KIND_ORDER.length);
    });
});
