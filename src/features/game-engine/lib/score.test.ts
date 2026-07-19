import { resolvePointsDelta } from './score';

describe('resolvePointsDelta', () => {
    it('награждает игрока за попадание по боту', () => {
        expect(resolvePointsDelta({ hittedIsLeft: false, leftActive: true, power: 12 })).toEqual({
            isPlayer: true,
            delta: 12,
        });
    });

    it('штрафует игрока за самострел', () => {
        expect(resolvePointsDelta({ hittedIsLeft: true, leftActive: true, power: 8 })).toEqual({
            isPlayer: true,
            delta: -8,
        });
    });

    it('награждает бота за попадание по игроку', () => {
        expect(resolvePointsDelta({ hittedIsLeft: true, leftActive: false, power: 15 })).toEqual({
            isPlayer: false,
            delta: 15,
        });
    });

    it('штрафует бота за самострел', () => {
        expect(resolvePointsDelta({ hittedIsLeft: false, leftActive: false, power: 5 })).toEqual({
            isPlayer: false,
            delta: -5,
        });
    });
});
