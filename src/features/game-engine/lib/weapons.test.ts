import { dealWeapons, WEAPONS_AMOUNT } from './weapons';

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
});
