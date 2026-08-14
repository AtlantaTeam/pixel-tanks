import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TANK_SKIN_ID } from '@/entities/tank-skins';
import { MAX_WIND } from '../../lib/wind';
import { windFlagRotationRad, windFlagSide } from '../../lib/wind-flag';
import { buildWindFlagScene, WIND_FLAG_DEMO_FRAME } from './build-wind-flag-scene';

// happy-dom не предоставляет Path2D, а конструктор `Tank` заводит им хит-зону
// (та же заглушка, что в `tank.test.ts`). Сцену это не касается: тест смотрит
// модель флажка и рельеф, а не хит-зону.
beforeAll(() => {
    if (typeof globalThis.Path2D === 'undefined') {
        vi.stubGlobal(
            'Path2D',
            class {
                rect() {}
                addPath() {}
            },
        );
    }
});

const scene = (wind: number) => buildWindFlagScene({ wind, skinId: DEFAULT_TANK_SKIN_ID });

describe('buildWindFlagScene — сцена демо флажка (#579)', () => {
    it('флажок на танке выставлен моделью ветра, а не своей копией формулы', () => {
        const wind = MAX_WIND * 0.7;

        const { tank } = scene(wind);

        expect(tank.windFlagRotationRad).toBe(windFlagRotationRad(wind));
        expect(tank.windFlagSide).toBe(windFlagSide(wind));
    });

    it('ветер влево зеркалит сторону провисания, как в бою', () => {
        expect(scene(-MAX_WIND).tank.windFlagSide).toBe(-1);
        expect(scene(MAX_WIND).tank.windFlagSide).toBe(1);
    });

    it('в штиль флажок в нейтрали, но нарисован (это не «чужой танк»)', () => {
        const { tank } = scene(0);

        expect(tank.windFlagRotationRad).toBeCloseTo(Math.PI / 2, 6);
        expect(tank.windFlagRotationRad).not.toBeNull();
    });

    it('рельеф демо плоский — наклон корпуса не спорит с наклоном полотнища', () => {
        const { ground } = scene(MAX_WIND);

        expect(ground.heights).toHaveLength(WIND_FLAG_DEMO_FRAME.width);
        expect(new Set(ground.heights).size).toBe(1);
        expect(ground.heights[0]).toBe(WIND_FLAG_DEMO_FRAME.groundHeight);
    });

    it('танк отмасштабирован кадром 1280 и стоит по центру кадра', () => {
        const { tank } = scene(0);

        expect(tank.scale).toBe(WIND_FLAG_DEMO_FRAME.scale);
        const center = tank.x + tank.tankWidth / 2;
        expect(Math.abs(center - WIND_FLAG_DEMO_FRAME.width / 2)).toBeLessThanOrEqual(1);
    });
});
