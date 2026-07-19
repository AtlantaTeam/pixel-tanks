import { generateRandomWeapons, WEAPONS_AMOUNT } from './weapons';

describe('generateRandomWeapons', () => {
    it('splits weapons evenly between the tanks', () => {
        const { leftTankWeapons, rightTankWeapons } = generateRandomWeapons(WEAPONS_AMOUNT);

        expect(leftTankWeapons).toHaveLength(WEAPONS_AMOUNT / 2);
        expect(rightTankWeapons).toHaveLength(WEAPONS_AMOUNT / 2);
    });

    it('is deterministic: two calls produce identical arsenals', () => {
        expect(generateRandomWeapons()).toEqual(generateRandomWeapons());
    });

    it('gives even ids to the left tank and odd ids to the right tank', () => {
        const { leftTankWeapons, rightTankWeapons } = generateRandomWeapons(4);

        expect(leftTankWeapons.map((w) => w.id)).toEqual([0, 2]);
        expect(rightTankWeapons.map((w) => w.id)).toEqual([1, 3]);
    });
});
