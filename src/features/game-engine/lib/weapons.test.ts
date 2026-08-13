import { EWeaponKind } from '@/shared/model';
import { dealWeapons, weaponKindForId, WEAPONS_AMOUNT } from './weapons';

describe('dealWeapons', () => {
    it('делит оружие поровну между танками', () => {
        const { leftTankWeapons, rightTankWeapons } = dealWeapons(WEAPONS_AMOUNT);

        expect(leftTankWeapons).toHaveLength(WEAPONS_AMOUNT / 2);
        expect(rightTankWeapons).toHaveLength(WEAPONS_AMOUNT / 2);
    });

    it('детерминирована: два вызова дают идентичные арсеналы', () => {
        expect(dealWeapons()).toEqual(dealWeapons());
    });

    it('отдаёт чётные id левому танку, нечётные — правому', () => {
        const { leftTankWeapons, rightTankWeapons } = dealWeapons(4);

        expect(leftTankWeapons.map((w) => w.id)).toEqual([0, 2]);
        expect(rightTankWeapons.map((w) => w.id)).toEqual([1, 3]);
    });

    it('раздаёт все четыре типа каждому танку (floor(id/2)%4, не id%4)', () => {
        const { leftTankWeapons, rightTankWeapons } = dealWeapons(WEAPONS_AMOUNT);

        // Левый (id 0,2,4,6,8) и правый (1,3,5,7,9) — каждый получает 0..3 плюс повтор.
        const kinds = [
            EWeaponKind.HighExplosive,
            EWeaponKind.Heavy,
            EWeaponKind.Cluster,
            EWeaponKind.Digger,
        ];
        for (const kind of kinds) {
            expect(leftTankWeapons.some((w) => w.kind === kind)).toBe(true);
            expect(rightTankWeapons.some((w) => w.kind === kind)).toBe(true);
        }
    });

    it('имя оружия — человекочитаемая метка его типа', () => {
        const { leftTankWeapons } = dealWeapons(2);
        expect(leftTankWeapons[0].kind).toBe(EWeaponKind.HighExplosive);
        expect(leftTankWeapons[0].name).toBe('Фугас');
    });

    it('weaponKindForId: тип от id по floor(id/2)%4', () => {
        expect(weaponKindForId(0)).toBe(EWeaponKind.HighExplosive);
        expect(weaponKindForId(1)).toBe(EWeaponKind.HighExplosive);
        expect(weaponKindForId(2)).toBe(EWeaponKind.Heavy);
        expect(weaponKindForId(4)).toBe(EWeaponKind.Cluster);
        expect(weaponKindForId(6)).toBe(EWeaponKind.Digger);
        expect(weaponKindForId(8)).toBe(EWeaponKind.HighExplosive);
    });
});
