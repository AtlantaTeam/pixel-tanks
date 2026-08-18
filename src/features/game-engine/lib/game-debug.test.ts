import { afterEach, describe, expect, it } from 'vitest';
import {
    buildGameDebugSnapshot,
    installGameDebugHook,
    uninstallGameDebugHook,
    type TGameDebugRect,
    type TGameDebugSource,
} from './game-debug';

function rect(x: number, y: number, width: number, height: number): TGameDebugRect {
    return { x, y, width, height };
}

/** Источник снапшота с заполненными ОБЯЗАТЕЛЬНЫМИ полями движка — тест
 *  перечисляет только то, что проверяет. Обязательными они и остаются в типе
 *  (`lastRedraw`, `Bullet.explosionRadius`): переименует их движок — тайпчек
 *  упадёт здесь, а не отдаст наружу молчаливый дефолт (ревью PR фазы). */
function source(partial: Partial<TGameDebugSource> = {}): TGameDebugSource {
    return { lastRedraw: 'none', ...partial };
}

describe('buildGameDebugSnapshot', () => {
    it('берёт прямоугольники корпуса из bodyRect() обоих танков', () => {
        const playerRect = rect(97, 400, 30, 15);
        const enemyRect = rect(293, 410, 30, 15);
        const snapshot = buildGameDebugSnapshot(
            source({
                leftTank: { bodyRect: () => playerRect },
                rightTank: { bodyRect: () => enemyRect },
            }),
        );

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
            explosionRadius: 0,
            lastRedraw: 'none',
        });
    });

    it('отдаёт null для танка, которого ещё нет (initPaint не завершён)', () => {
        const snapshot = buildGameDebugSnapshot(source());

        expect(snapshot).toEqual({
            player: null,
            enemy: null,
            bulletInFlight: false,
            particlesAlive: false,
            explosionActive: false,
            groundFalling: false,
            explosionRadius: 0,
            lastRedraw: 'none',
        });
    });

    it('снаряд в полёте — пока объект есть и не сдетонировал', () => {
        // Фаза боя для эталонных кадров сцены (#585): кадр «полёт» снимается по
        // состоянию движка, а не по угаданной миллисекунде.
        expect(
            buildGameDebugSnapshot(source({ bullet: { detonated: false, explosionRadius: 0 } }))
                .bulletInFlight,
        ).toBe(true);
    });

    it('сдетонировавший снаряд полётом уже не считается', () => {
        expect(
            buildGameDebugSnapshot(source({ bullet: { detonated: true, explosionRadius: 8 } }))
                .bulletInFlight,
        ).toBe(false);
    });

    it('сдетонировавший, но живой снаряд — это растущий очаг взрыва', () => {
        // Кадр «после взрыва» ждёт конца очага: частицы догорают раньше вспышки,
        // и без этого флага в кадр попадала бы она, а не воронка.
        expect(
            buildGameDebugSnapshot(source({ bullet: { detonated: true, explosionRadius: 8 } }))
                .explosionActive,
        ).toBe(true);
    });

    it('снаряд в полёте очагом взрыва ещё не считается', () => {
        expect(
            buildGameDebugSnapshot(source({ bullet: { detonated: false, explosionRadius: 0 } }))
                .explosionActive,
        ).toBe(false);
    });

    it('без снаряда очага нет — false, а не undefined', () => {
        expect(buildGameDebugSnapshot(source()).explosionActive).toBe(false);
    });

    it('взрыв виден по живым частицам, осыпание — по падающей земле', () => {
        const snapshot = buildGameDebugSnapshot(
            source({ hasAliveParticles: true, ground: { isFalling: true } }),
        );

        expect(snapshot.particlesAlive).toBe(true);
        expect(snapshot.groundFalling).toBe(true);
    });

    it('без частиц и осыпания отдаёт false, а не undefined', () => {
        const snapshot = buildGameDebugSnapshot(
            source({ hasAliveParticles: false, ground: { isFalling: false } }),
        );

        expect(snapshot.particlesAlive).toBe(false);
        expect(snapshot.groundFalling).toBe(false);
    });

    it('отдаёт радиус растущего очага взрыва (issue #605)', () => {
        expect(
            buildGameDebugSnapshot(source({ bullet: { detonated: true, explosionRadius: 42 } }))
                .explosionRadius,
        ).toBe(42);
    });

    it('без снаряда радиус — 0, а не undefined', () => {
        expect(buildGameDebugSnapshot(source()).explosionRadius).toBe(0);
    });

    it('отдаёт ветку перерисовки последнего кадра как есть (ревью PR фазы)', () => {
        // Кадр «частицы догорели» (#605) цепляется именно за неё: три косвенных
        // признака (частицы, тряска, снаряд) сторожат тот же факт хуже.
        expect(buildGameDebugSnapshot(source({ lastRedraw: 'explosion-area' })).lastRedraw).toBe(
            'explosion-area',
        );
        expect(buildGameDebugSnapshot(source({ lastRedraw: 'full' })).lastRedraw).toBe('full');
    });
});

describe('install/uninstallGameDebugHook', () => {
    afterEach(() => {
        uninstallGameDebugHook();
    });

    it('публикует снапшот через window.__gameDebug.getSnapshot()', () => {
        const playerRect = rect(1, 2, 3, 4);
        installGameDebugHook(() => source({ leftTank: { bodyRect: () => playerRect } }));

        expect(window.__gameDebug?.getSnapshot()).toEqual({
            player: playerRect,
            enemy: null,
            bulletInFlight: false,
            particlesAlive: false,
            explosionActive: false,
            groundFalling: false,
            explosionRadius: 0,
            lastRedraw: 'none',
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
