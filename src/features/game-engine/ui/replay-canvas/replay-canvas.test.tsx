import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import type { TReplay } from '@/entities/replays';
import { REPLAY_MOVE_DELAY_MS } from '../../lib/replay-driver';
import { ReplayCanvas } from './replay-canvas';

type TWeaponStub = { id: number; name: string };

// Мок GamePlay: даёт драйверу «готовый к ходу» движок без Canvas и картинок.
// captured.current — последний созданный инстанс, чтобы дёргать его из тестов.
const { captured } = vi.hoisted(() => ({
    captured: { current: null as Record<string, unknown> | null },
}));

vi.mock('../../lib/game-play', () => ({
    GamePlay: class {
        leftTank = {
            isActive: true,
            dx: 0,
            dy: 0,
            weapons: [{ id: 0, name: 'Bullet' }] as TWeaponStub[],
            gunpointAngle: 0,
            power: 10,
        };
        rightTank = { dx: 0, dy: 0, x: 200, tankWidth: 40, y: 150, tankHeight: 30 };
        ground = { isFalling: false };
        bullet = undefined;
        isFireMode = false;
        isMoveMode = false;
        changeTankPosition = vi.fn();
        onFire = vi.fn();
        loadImages = vi.fn();
        destroy = vi.fn();
        constructor() {
            captured.current = this as unknown as Record<string, unknown>;
        }
    },
}));

const REPLAY: TReplay = {
    seed: 42,
    moves: [{ kind: 'fire', angle: -0.75, power: 12 }],
};

describe('ReplayCanvas', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        captured.current = null;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('plays the recorded move through the engine without user input', () => {
        render(<ReplayCanvas replay={REPLAY} />);
        const game = captured.current as unknown as {
            leftTank: { gunpointAngle: number; power: number; weapons: TWeaponStub[] };
            onFire: ReturnType<typeof vi.fn>;
            loadImages: ReturnType<typeof vi.fn>;
        };

        expect(game.loadImages).toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(REPLAY_MOVE_DELAY_MS + 300);
        });

        expect(game.leftTank.gunpointAngle).toBe(-0.75);
        expect(game.leftTank.power).toBe(12);
        expect(game.onFire).toHaveBeenCalledWith(game.leftTank.weapons[0]);
    });

    it('waits while the engine is busy instead of forcing the move', () => {
        render(<ReplayCanvas replay={REPLAY} />);
        const game = captured.current as unknown as {
            isFireMode: boolean;
            onFire: ReturnType<typeof vi.fn>;
        };
        game.isFireMode = true;

        act(() => {
            vi.advanceTimersByTime(REPLAY_MOVE_DELAY_MS * 5);
        });

        expect(game.onFire).not.toHaveBeenCalled();
    });

    it('stops the playback timer and engine on unmount', () => {
        const { unmount } = render(<ReplayCanvas replay={REPLAY} />);
        const game = captured.current as unknown as {
            destroy: ReturnType<typeof vi.fn>;
            onFire: ReturnType<typeof vi.fn>;
        };

        unmount();
        act(() => {
            vi.advanceTimersByTime(REPLAY_MOVE_DELAY_MS * 5);
        });

        expect(game.destroy).toHaveBeenCalled();
        expect(game.onFire).not.toHaveBeenCalled();
    });
});
