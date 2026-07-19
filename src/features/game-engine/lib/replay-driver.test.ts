import { vi } from 'vitest';
import type { TReplayMove } from '@/entities/replays';
import {
    createReplayEngineAdapter,
    ReplayDriver,
    REPLAY_MOVE_DELAY_MS,
    type TReplayEngine,
    type TReplayGameSurface,
} from './replay-driver';

const createEngineMock = (ready = true) => {
    const engine: TReplayEngine & { ready: boolean } = {
        ready,
        isReadyForNextMove: () => engine.ready,
        applyMove: vi.fn(),
        applyFire: vi.fn(),
    };
    return engine;
};

const MOVES: TReplayMove[] = [
    { kind: 'move', delta: -150 },
    { kind: 'fire', angle: -0.75, power: 12 },
];

describe('ReplayDriver', () => {
    it('не применяет ход, пока движок занят', () => {
        const engine = createEngineMock(false);
        const driver = new ReplayDriver(MOVES, engine);

        driver.tick(0);
        driver.tick(REPLAY_MOVE_DELAY_MS * 10);

        expect(engine.applyMove).not.toHaveBeenCalled();
        expect(engine.applyFire).not.toHaveBeenCalled();
    });

    it('применяет первый ход только после выдержки паузы с момента готовности', () => {
        const engine = createEngineMock();
        const driver = new ReplayDriver(MOVES, engine, 500);

        expect(driver.tick(1000)).toBe(false);
        expect(driver.tick(1400)).toBe(false);
        expect(driver.tick(1500)).toBe(true);

        expect(engine.applyMove).toHaveBeenCalledWith(-150);
    });

    it('перезапускает паузу, когда готовность прервалась в середине ожидания', () => {
        const engine = createEngineMock();
        const driver = new ReplayDriver(MOVES, engine, 500);

        driver.tick(0);
        engine.ready = false;
        driver.tick(400);
        engine.ready = true;
        // Готовность прервалась — отсчёт паузы начинается заново с 800.
        expect(driver.tick(800)).toBe(false);
        expect(driver.tick(1200)).toBe(false);
        expect(driver.tick(1300)).toBe(true);
    });

    it('применяет ходы в записанном порядке с их данными', () => {
        const engine = createEngineMock();
        const driver = new ReplayDriver(MOVES, engine, 0);

        driver.tick(0);
        driver.tick(1);
        driver.tick(2);
        driver.tick(3);

        expect(engine.applyMove).toHaveBeenCalledTimes(1);
        expect(engine.applyMove).toHaveBeenCalledWith(-150);
        expect(engine.applyFire).toHaveBeenCalledTimes(1);
        expect(engine.applyFire).toHaveBeenCalledWith(-0.75, 12);
    });

    it('становится завершённым после последнего хода и перестаёт дёргать движок', () => {
        const engine = createEngineMock();
        const driver = new ReplayDriver([MOVES[1]], engine, 0);

        expect(driver.isFinished).toBe(false);
        driver.tick(0);
        driver.tick(1);
        expect(driver.isFinished).toBe(true);

        expect(driver.tick(2)).toBe(false);
        expect(engine.applyFire).toHaveBeenCalledTimes(1);
    });

    it('сразу завершён для пустого списка ходов', () => {
        const engine = createEngineMock();
        const driver = new ReplayDriver([], engine, 0);

        expect(driver.isFinished).toBe(true);
        expect(driver.tick(0)).toBe(false);
    });
});

describe('createReplayEngineAdapter', () => {
    const createGameMock = (): TReplayGameSurface & {
        changeTankPosition: ReturnType<typeof vi.fn>;
        onFire: ReturnType<typeof vi.fn>;
    } => ({
        leftTank: {
            isActive: true,
            dx: 0,
            dy: 0,
            weapons: [{ id: 0, name: 'Bullet' }],
            gunpointAngle: 0,
            power: 10,
        },
        rightTank: { dx: 0, dy: 0 },
        ground: { isFalling: false },
        bullet: undefined,
        isFireMode: false,
        isMoveMode: false,
        changeTankPosition: vi.fn(),
        onFire: vi.fn(),
    });

    it('готов только в спокойный ход левого (игрокового) танка', () => {
        const game = createGameMock();
        const adapter = createReplayEngineAdapter(game);

        expect(adapter.isReadyForNextMove()).toBe(true);
    });

    it.each([
        ['танки ещё не инициализированы', (g: TReplayGameSurface) => (g.leftTank = undefined)],
        ['ход бота', (g: TReplayGameSurface) => (g.leftTank!.isActive = false)],
        ['выстрел в процессе', (g: TReplayGameSurface) => (g.isFireMode = true)],
        ['перемещение танка в процессе', (g: TReplayGameSurface) => (g.isMoveMode = true)],
        ['снаряд в полёте', (g: TReplayGameSurface) => (g.bullet = {})],
        ['земля осыпается', (g: TReplayGameSurface) => (g.ground!.isFalling = true)],
        ['левый танк ещё движется', (g: TReplayGameSurface) => (g.leftTank!.dx = 5)],
        ['левый танк падает', (g: TReplayGameSurface) => (g.leftTank!.dy = 2)],
        ['правый танк падает', (g: TReplayGameSurface) => (g.rightTank!.dy = 2)],
    ])('не готов, когда %s', (_label, mutate) => {
        const game = createGameMock();
        mutate(game);

        expect(createReplayEngineAdapter(game).isReadyForNextMove()).toBe(false);
    });

    it('делегирует applyMove в changeTankPosition', () => {
        const game = createGameMock();
        createReplayEngineAdapter(game).applyMove(-150);

        expect(game.changeTankPosition).toHaveBeenCalledWith(-150);
    });

    it('ставит угол и мощность на танк и стреляет его первым оружием', () => {
        const game = createGameMock();
        createReplayEngineAdapter(game).applyFire(-0.75, 12);

        expect(game.leftTank?.gunpointAngle).toBe(-0.75);
        expect(game.leftTank?.power).toBe(12);
        expect(game.onFire).toHaveBeenCalledWith(game.leftTank?.weapons[0]);
    });

    it('не стреляет, когда у танка не осталось оружия', () => {
        const game = createGameMock();
        game.leftTank!.weapons = [];
        createReplayEngineAdapter(game).applyFire(-0.75, 12);

        expect(game.onFire).not.toHaveBeenCalled();
    });
});
