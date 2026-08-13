import { afterEach, describe, expect, it } from 'vitest';
import {
    buildGameDebugSnapshot,
    installGameDebugHook,
    uninstallGameDebugHook,
    type TGameDebugRect,
} from './game-debug';

function rect(x: number, y: number, width: number, height: number): TGameDebugRect {
    return { x, y, width, height };
}

describe('buildGameDebugSnapshot', () => {
    it('берёт прямоугольники корпуса из bodyRect() обоих танков', () => {
        const playerRect = rect(97, 400, 30, 15);
        const enemyRect = rect(293, 410, 30, 15);
        const snapshot = buildGameDebugSnapshot({
            leftTank: { bodyRect: () => playerRect },
            rightTank: { bodyRect: () => enemyRect },
        });

        expect(snapshot).toEqual({ player: playerRect, enemy: enemyRect });
    });

    it('отдаёт null для танка, которого ещё нет (initPaint не завершён)', () => {
        const snapshot = buildGameDebugSnapshot({});

        expect(snapshot).toEqual({ player: null, enemy: null });
    });
});

describe('install/uninstallGameDebugHook', () => {
    afterEach(() => {
        uninstallGameDebugHook();
    });

    it('публикует снапшот через window.__gameDebug.getSnapshot()', () => {
        const playerRect = rect(1, 2, 3, 4);
        installGameDebugHook(() => ({ leftTank: { bodyRect: () => playerRect } }));

        expect(window.__gameDebug?.getSnapshot()).toEqual({ player: playerRect, enemy: null });
    });

    it('отдаёт null, если движка ещё нет (до инициализации / после destroy)', () => {
        installGameDebugHook(() => null);

        expect(window.__gameDebug?.getSnapshot()).toBeNull();
    });

    it('снимает хук — getSnapshot больше не доступен', () => {
        installGameDebugHook(() => null);
        uninstallGameDebugHook();

        expect(window.__gameDebug).toBeUndefined();
    });
});
