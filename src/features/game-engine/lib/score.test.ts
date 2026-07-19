import { resolvePointsDelta } from './score';

describe('resolvePointsDelta', () => {
    it('rewards the player for hitting the bot', () => {
        expect(resolvePointsDelta({ hittedIsLeft: false, leftActive: true, power: 12 })).toEqual({
            isPlayer: true,
            delta: 12,
        });
    });

    it('penalizes the player for a self-hit', () => {
        expect(resolvePointsDelta({ hittedIsLeft: true, leftActive: true, power: 8 })).toEqual({
            isPlayer: true,
            delta: -8,
        });
    });

    it('rewards the bot for hitting the player', () => {
        expect(resolvePointsDelta({ hittedIsLeft: true, leftActive: false, power: 15 })).toEqual({
            isPlayer: false,
            delta: 15,
        });
    });

    it('penalizes the bot for a self-hit', () => {
        expect(resolvePointsDelta({ hittedIsLeft: false, leftActive: false, power: 5 })).toEqual({
            isPlayer: false,
            delta: -5,
        });
    });
});
