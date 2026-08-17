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

        // Форма снапшота контрактная — он уходит в `window` прод-сборки, поэтому
        // сверяем целиком (`toEqual`): `toMatchObject` пропустил бы и опечатку в
        // имени поля, и случайно просочившийся объект движка.
        expect(snapshot).toEqual({
            player: playerRect,
            enemy: enemyRect,
            bulletInFlight: false,
            particlesAlive: false,
            explosionActive: false,
            groundFalling: false,
        });
    });

    it('отдаёт null для танка, которого ещё нет (initPaint не завершён)', () => {
        const snapshot = buildGameDebugSnapshot({});

        expect(snapshot).toEqual({
            player: null,
            enemy: null,
            bulletInFlight: false,
            particlesAlive: false,
            explosionActive: false,
            groundFalling: false,
        });
    });

    it('снаряд в полёте — пока объект есть и не сдетонировал', () => {
        // Фаза боя для эталонных кадров сцены (#585): кадр «полёт» снимается по
        // состоянию движка, а не по угаданной миллисекунде.
        expect(buildGameDebugSnapshot({ bullet: { detonated: false } }).bulletInFlight).toBe(true);
    });

    it('сдетонировавший снаряд полётом уже не считается', () => {
        expect(buildGameDebugSnapshot({ bullet: { detonated: true } }).bulletInFlight).toBe(false);
    });

    it('сдетонировавший, но живой снаряд — это растущий очаг взрыва', () => {
        // Кадр «после взрыва» ждёт конца очага: частицы догорают раньше вспышки,
        // и без этого флага в кадр попадала бы она, а не воронка.
        expect(buildGameDebugSnapshot({ bullet: { detonated: true } }).explosionActive).toBe(true);
    });

    it('снаряд в полёте очагом взрыва ещё не считается', () => {
        expect(buildGameDebugSnapshot({ bullet: { detonated: false } }).explosionActive).toBe(
            false,
        );
    });

    it('без снаряда очага нет — false, а не undefined', () => {
        expect(buildGameDebugSnapshot({}).explosionActive).toBe(false);
    });

    it('взрыв виден по живым частицам, осыпание — по падающей земле', () => {
        const snapshot = buildGameDebugSnapshot({
            hasAliveParticles: true,
            ground: { isFalling: true },
        });

        expect(snapshot.particlesAlive).toBe(true);
        expect(snapshot.groundFalling).toBe(true);
    });

    it('без частиц и осыпания отдаёт false, а не undefined', () => {
        const snapshot = buildGameDebugSnapshot({
            hasAliveParticles: false,
            ground: { isFalling: false },
        });

        expect(snapshot.particlesAlive).toBe(false);
        expect(snapshot.groundFalling).toBe(false);
    });
});

describe('install/uninstallGameDebugHook', () => {
    afterEach(() => {
        uninstallGameDebugHook();
    });

    it('публикует снапшот через window.__gameDebug.getSnapshot()', () => {
        const playerRect = rect(1, 2, 3, 4);
        installGameDebugHook(() => ({ leftTank: { bodyRect: () => playerRect } }));

        expect(window.__gameDebug?.getSnapshot()).toEqual({
            player: playerRect,
            enemy: null,
            bulletInFlight: false,
            particlesAlive: false,
            explosionActive: false,
            groundFalling: false,
        });
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
