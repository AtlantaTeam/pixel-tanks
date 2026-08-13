import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TANK_SKINS } from '@/entities/tank-skins';
import { Tank } from './tank';
import { WORLD_UNITS } from './world-scale';

// Tank создаёт `new Path2D()` в конструкторе безусловно — happy-dom его не
// предоставляет (см. тот же приём в tank.test.ts/game-play.test.ts).
class Path2DStub {
    rect() {}
    addPath() {}
}

beforeAll(() => {
    if (typeof globalThis.Path2D === 'undefined') {
        vi.stubGlobal('Path2D', Path2DStub);
    }
});

/**
 * Критерий готовности issue #481: «скин не меняет ни один параметр боя».
 * Картинки корпуса/ствола — чисто отрисовочные аргументы конструктора Tank,
 * все боевые величины считаются от `WORLD_UNITS`/`scale` и не зависят от них.
 */
describe('скин танка не влияет ни на один параметр боя', () => {
    const stubImage = (label: string) => ({ label }) as unknown as HTMLImageElement;

    const BATTLE_FIELDS = [
        'tankWidth',
        'tankHeight',
        'gunpointAngleMin',
        'gunpointAngleMax',
        'powerMin',
        'powerMax',
        'power',
        'scale',
    ] as const;

    it('Tank с разными картинками корпуса/ствола имеет одинаковые боевые поля', () => {
        const withoutImages = new Tank(100, 200, 800, 600, 0, [], undefined, undefined, 1.25);
        const withSkinA = new Tank(
            100,
            200,
            800,
            600,
            0,
            [],
            stubImage('hull-a'),
            stubImage('barrel-a'),
            1.25,
        );
        const withSkinB = new Tank(
            100,
            200,
            800,
            600,
            0,
            [],
            stubImage('hull-b'),
            stubImage('barrel-b'),
            1.25,
        );

        for (const field of BATTLE_FIELDS) {
            expect(withSkinA[field]).toBe(withoutImages[field]);
            expect(withSkinB[field]).toBe(withoutImages[field]);
        }
        expect(withSkinA.bodyRect()).toEqual(withoutImages.bodyRect());
        expect(withSkinB.bodyRect()).toEqual(withoutImages.bodyRect());
    });

    it('размеры танка при любом скине остаются каноном WORLD_UNITS × scale', () => {
        const scale = 0.8;
        for (const skin of TANK_SKINS) {
            const tank = new Tank(
                0,
                0,
                800,
                600,
                0,
                [],
                stubImage(skin.id),
                stubImage(`${skin.id}-barrel`),
                scale,
            );
            expect(tank.tankWidth).toBe(WORLD_UNITS.tankWidth * scale);
            expect(tank.tankHeight).toBe(WORLD_UNITS.tankHeight * scale);
        }
    });

    it('реестр скинов не содержит боевых полей (HP/скорость/разброс) — только id/геометрия/палитра', () => {
        for (const skin of TANK_SKINS) {
            expect(Object.keys(skin).sort()).toEqual(['geometry', 'id', 'palette']);
        }
    });
});
