import { beforeEach, describe, expect, it } from 'vitest';
import { POWER_MAX, POWER_MIN } from '../lib/power';
import { deriveOutcome, MAX_HP, selectIsBotTurn, useGameStore } from './game.store';

describe('game.store — запись реплея', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('изначально не имеет seed боя, размера поля и ходов', () => {
        const state = useGameStore.getState();

        expect(state.battleSeed).toBeNull();
        expect(state.battleField).toBeNull();
        expect(state.replayMoves).toEqual([]);
    });

    it('запоминает seed боя', () => {
        useGameStore.getState().setBattleSeed(42);

        expect(useGameStore.getState().battleSeed).toBe(42);
    });

    it('запоминает логический размер поля боя', () => {
        useGameStore.getState().setBattleField(1440, 810);

        expect(useGameStore.getState().battleField).toEqual({ width: 1440, height: 810 });
    });

    it('запоминает строковый seed боя', () => {
        useGameStore.getState().setBattleSeed('daily-2026-07-19');

        expect(useGameStore.getState().battleSeed).toBe('daily-2026-07-19');
    });

    it('добавляет ход перемещения в порядке вызовов', () => {
        useGameStore.getState().recordMove(-150);
        useGameStore.getState().recordMove(150);

        expect(useGameStore.getState().replayMoves).toEqual([
            { kind: 'move', delta: -150 },
            { kind: 'move', delta: 150 },
        ]);
    });

    it('добавляет ход выстрела', () => {
        useGameStore.getState().recordFire(1.23, 15);

        expect(useGameStore.getState().replayMoves).toEqual([
            { kind: 'fire', angle: 1.23, power: 15 },
        ]);
    });

    it('чередует ходы перемещения и выстрела в порядке записи', () => {
        useGameStore.getState().recordMove(-150);
        useGameStore.getState().recordFire(0.5, 10);

        expect(useGameStore.getState().replayMoves).toEqual([
            { kind: 'move', delta: -150 },
            { kind: 'fire', angle: 0.5, power: 10 },
        ]);
    });

    it('не даёт увести мощность выше верхнего предела ни setPower, ни increasePower', () => {
        useGameStore.getState().setPower(999);
        expect(useGameStore.getState().power).toBe(POWER_MAX);

        // Экранная кнопка «Мощность» звала increasePower напрямую, минуя кламп
        // движка — теперь предел держит сам стор (#264).
        useGameStore.getState().setPower(POWER_MAX);
        useGameStore.getState().increasePower(5);
        expect(useGameStore.getState().power).toBe(POWER_MAX);
    });

    it('не даёт увести мощность ниже нижнего предела ни setPower, ни increasePower', () => {
        useGameStore.getState().setPower(-10);
        expect(useGameStore.getState().power).toBe(POWER_MIN);

        useGameStore.getState().setPower(POWER_MIN);
        useGameStore.getState().increasePower(-5);
        expect(useGameStore.getState().power).toBe(POWER_MIN);
    });

    it('оставляет мощность внутри диапазона без изменений', () => {
        useGameStore.getState().setPower(12);
        expect(useGameStore.getState().power).toBe(12);

        useGameStore.getState().increasePower(3);
        expect(useGameStore.getState().power).toBe(15);
    });

    it('resetGame очищает seed боя, размер поля и записанные ходы', () => {
        useGameStore.getState().setBattleSeed('daily-2026-07-19');
        useGameStore.getState().setBattleField(800, 600);
        useGameStore.getState().recordMove(150);

        useGameStore.getState().resetGame();

        expect(useGameStore.getState().battleSeed).toBeNull();
        expect(useGameStore.getState().battleField).toBeNull();
        expect(useGameStore.getState().replayMoves).toEqual([]);
    });
});

describe('game.store — HP-модель боя', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('начинает бой с полным HP у обеих сторон', () => {
        const state = useGameStore.getState();

        expect(state.hp).toEqual({ player: MAX_HP, enemy: MAX_HP });
    });

    it('попадание снимает урон оружия с HP цели', () => {
        useGameStore.getState().applyDamage('enemy', 30);

        expect(useGameStore.getState().hp).toEqual({ player: MAX_HP, enemy: MAX_HP - 30 });
    });

    it('накопление урона по одной стороне суммируется', () => {
        useGameStore.getState().applyDamage('enemy', 20);
        useGameStore.getState().applyDamage('enemy', 15);

        expect(useGameStore.getState().hp.enemy).toBe(MAX_HP - 35);
    });

    it('урон больше остатка HP не уводит HP ниже нуля (клампится в 0)', () => {
        useGameStore.setState({ hp: { player: 10, enemy: MAX_HP } });

        useGameStore.getState().applyDamage('player', 30);

        expect(useGameStore.getState().hp.player).toBe(0);
    });

    it('урон по уже мёртвому танку оставляет HP на нуле', () => {
        useGameStore.setState({ hp: { player: 0, enemy: MAX_HP } });

        useGameStore.getState().applyDamage('player', 25);

        expect(useGameStore.getState().hp.player).toBe(0);
    });

    it('отрицательный урон (лечение) не уводит HP выше максимума', () => {
        useGameStore.getState().applyDamage('enemy', -50);

        expect(useGameStore.getState().hp.enemy).toBe(MAX_HP);
    });

    it('добивание цели заканчивает бой по HP и фиксирует фазу over', () => {
        useGameStore.setState({ hp: { player: MAX_HP, enemy: 15 } });

        useGameStore.getState().applyDamage('enemy', 15);

        const state = useGameStore.getState();
        expect(state.hp.enemy).toBe(0);
        expect(state.isGameOver).toBe(true);
        expect(state.phase).toBe('over');
    });
});

describe('game.store — исход выводится из HP', () => {
    it('победа: у игрока HP больше', () => {
        expect(deriveOutcome(60, 0)).toBe('victory');
    });

    it('поражение: у игрока HP меньше', () => {
        expect(deriveOutcome(0, 40)).toBe('defeat');
    });

    it('ничья: HP равны', () => {
        expect(deriveOutcome(20, 20)).toBe('draw');
    });
});

describe('game.store — предикат «ход бота» (selectIsBotTurn)', () => {
    it('истина: ходит соперник и бой идёт', () => {
        expect(selectIsBotTurn({ turn: 'enemy', phase: 'flight' })).toBe(true);
    });

    it('ложь: ходит игрок', () => {
        expect(selectIsBotTurn({ turn: 'player', phase: 'aiming' })).toBe(false);
    });

    it('ложь: бой окончен, даже если ход был за соперником', () => {
        expect(selectIsBotTurn({ turn: 'enemy', phase: 'over' })).toBe(false);
    });
});

describe('game.store — фаза хода', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('покоящийся стор в фазе idle', () => {
        expect(useGameStore.getState().phase).toBe('idle');
    });

    it('startGame переводит в фазу прицеливания', () => {
        useGameStore.getState().startGame();

        expect(useGameStore.getState().phase).toBe('aiming');
    });

    it('setPhase меняет фазу', () => {
        useGameStore.getState().setPhase('resolving');

        expect(useGameStore.getState().phase).toBe('resolving');
    });

    it('выстрел из фазы прицеливания переводит в полёт', () => {
        useGameStore.getState().startGame();

        useGameStore.getState().fire();

        expect(useGameStore.getState().phase).toBe('flight');
    });

    it('выстрел вне своей фазы игнорируется (лок хода соперника)', () => {
        useGameStore.getState().setPhase('flight');

        useGameStore.getState().fire();

        expect(useGameStore.getState().phase).toBe('flight');
    });
});

describe('game.store — статистика боя (выстрелы и попадания)', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('recordFire считает выстрелы игрока (единый источник с числом ходов fire)', () => {
        useGameStore.getState().recordFire(0.1, 5);
        useGameStore.getState().recordFire(0.2, 6);

        const state = useGameStore.getState();
        expect(state.shotsFired).toBe(2);
        // Счётчик выстрелов и число ходов kind:'fire' в реплее не расходятся.
        expect(state.replayMoves.filter((m) => m.kind === 'fire')).toHaveLength(2);
    });

    it('recordPlayerHit считает попадания игрока', () => {
        useGameStore.getState().recordFire(0.1, 5);
        useGameStore.getState().recordFire(0.2, 6);
        useGameStore.getState().recordPlayerHit();

        expect(useGameStore.getState().shotsFired).toBe(2);
        expect(useGameStore.getState().hits).toBe(1);
    });

    it('startGame и resetGame обнуляют выстрелы и попадания', () => {
        useGameStore.getState().recordFire(0.1, 5);
        useGameStore.getState().recordPlayerHit();

        useGameStore.getState().startGame();
        expect(useGameStore.getState().shotsFired).toBe(0);
        expect(useGameStore.getState().hits).toBe(0);

        useGameStore.getState().recordFire(0.1, 5);
        useGameStore.getState().resetGame();
        expect(useGameStore.getState().shotsFired).toBe(0);
        expect(useGameStore.getState().hits).toBe(0);
    });
});

describe('game.store — раскрытие ветра', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('ветер скрыт до первого выстрела', () => {
        useGameStore.getState().startGame();

        expect(useGameStore.getState().windRevealed).toBe(false);
    });

    it('первый выстрел игрока раскрывает ветер', () => {
        useGameStore.getState().startGame();

        useGameStore.getState().fire();

        expect(useGameStore.getState().windRevealed).toBe(true);
    });

    it('раскрытый ветер держится до конца боя', () => {
        useGameStore.getState().startGame();
        useGameStore.getState().fire();

        // Смена фаз до конца боя не прячет ветер обратно.
        useGameStore.getState().setPhase('resolving');
        useGameStore.getState().setPhase('aiming');
        useGameStore.getState().setGameOver();

        expect(useGameStore.getState().windRevealed).toBe(true);
    });

    it('игнорируемый выстрел вне фазы ветер не раскрывает', () => {
        useGameStore.getState().setPhase('flight');

        useGameStore.getState().fire();

        expect(useGameStore.getState().windRevealed).toBe(false);
    });
});

describe('game.store — снимок HP на конце боя (#337)', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('не имеет зафиксированного снимка HP до конца боя', () => {
        expect(useGameStore.getState().finalHp).toBeNull();
    });

    it('фиксирует HP один раз на переходе isGameOver false→true', () => {
        useGameStore.setState({ hp: { player: 70, enemy: 40 } });

        useGameStore.getState().setGameOver();

        expect(useGameStore.getState().finalHp).toEqual({ player: 70, enemy: 40 });
    });

    it('не переписывает снимок, если HP меняется после фиксации исхода', () => {
        useGameStore.setState({ hp: { player: 55, enemy: 55 } });
        useGameStore.getState().setGameOver();

        // «Оседающие» кадры последнего попадания (root-cause #337) — после
        // фиксации исход больше не должен на них реагировать.
        useGameStore.getState().applyDamage('player', 30);

        expect(useGameStore.getState().finalHp).toEqual({ player: 55, enemy: 55 });
    });

    it('сбрасывает снимок при startGame и resetGame', () => {
        useGameStore.setState({ hp: { player: 70, enemy: 10 } });
        useGameStore.getState().setGameOver();

        useGameStore.getState().startGame();

        expect(useGameStore.getState().finalHp).toBeNull();

        useGameStore.setState({ hp: { player: 30, enemy: 30 } });
        useGameStore.getState().setGameOver();
        useGameStore.getState().resetGame();

        expect(useGameStore.getState().finalHp).toBeNull();
    });
});

describe('game.store — снимок статистики на конце боя', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('не имеет снимка статистики до конца боя', () => {
        expect(useGameStore.getState().finalStats).toBeNull();
    });

    it('фиксирует выстрелы/попадания/манёвры вместе с HP на конце боя', () => {
        useGameStore.getState().recordFire(0.1, 5);
        useGameStore.getState().recordFire(0.2, 6);
        useGameStore.getState().recordPlayerHit();
        useGameStore.getState().decrementMoves();

        useGameStore.getState().setGameOver();

        expect(useGameStore.getState().finalStats).toEqual({ shots: 2, hits: 1, maneuvers: 1 });
    });

    it('не переписывает снимок статистики, если стор дрогнет после фиксации исхода', () => {
        useGameStore.getState().recordFire(0.1, 5);
        useGameStore.getState().setGameOver();

        // Ввод/оседающее попадание за уже открытым диалогом не должны менять
        // показанную статистику (симметрично снимку HP, #337).
        useGameStore.getState().recordFire(0.2, 6);
        useGameStore.getState().recordPlayerHit();

        expect(useGameStore.getState().finalStats).toEqual({ shots: 1, hits: 0, maneuvers: 0 });
    });

    it('сбрасывает снимок статистики при startGame и resetGame', () => {
        useGameStore.getState().recordFire(0.1, 5);
        useGameStore.getState().setGameOver();

        useGameStore.getState().startGame();
        expect(useGameStore.getState().finalStats).toBeNull();

        useGameStore.getState().recordFire(0.1, 5);
        useGameStore.getState().setGameOver();
        useGameStore.getState().resetGame();
        expect(useGameStore.getState().finalStats).toBeNull();
    });
});

describe('game.store — добивание в режиме реплея (endsBattle=false)', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('снимает урон, но НЕ заканчивает бой по HP (конец ставит драйвер реплея)', () => {
        useGameStore.setState({ hp: { player: MAX_HP, enemy: 15 } });

        useGameStore.getState().applyDamage('enemy', 15, false);

        const state = useGameStore.getState();
        expect(state.hp.enemy).toBe(0);
        expect(state.isGameOver).toBe(false);
        expect(state.phase).toBe('idle');
        expect(state.finalHp).toBeNull();
    });
});

describe('game.store — чей ход', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('покоящийся стор и свежий startGame — ход игрока', () => {
        expect(useGameStore.getState().turn).toBe('player');

        useGameStore.getState().setTurn('enemy');
        useGameStore.getState().startGame();

        expect(useGameStore.getState().turn).toBe('player');
    });

    it('setTurn переключает сторону хода', () => {
        useGameStore.getState().setTurn('enemy');

        expect(useGameStore.getState().turn).toBe('enemy');
    });

    it('resetGame возвращает ход игроку', () => {
        useGameStore.getState().setTurn('enemy');

        useGameStore.getState().resetGame();

        expect(useGameStore.getState().turn).toBe('player');
    });
});

describe('game.store — ветер боя', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('покоящийся стор без ветра', () => {
        expect(useGameStore.getState().wind).toBe(0);
    });

    it('setWind запоминает ветер боя', () => {
        useGameStore.getState().setWind(-0.006);

        expect(useGameStore.getState().wind).toBe(-0.006);
    });

    it('startGame и resetGame обнуляют ветер предыдущего боя', () => {
        useGameStore.getState().setWind(0.009);

        useGameStore.getState().startGame();
        expect(useGameStore.getState().wind).toBe(0);

        useGameStore.getState().setWind(0.009);
        useGameStore.getState().resetGame();
        expect(useGameStore.getState().wind).toBe(0);
    });
});

describe('game.store — startGame стартует чистую запись реплея', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('сбрасывает ходы, seed и размер поля предыдущего боя', () => {
        useGameStore.getState().setBattleSeed(42);
        useGameStore.getState().setBattleField(800, 600);
        useGameStore.getState().recordFire(0.1, 5);

        useGameStore.getState().startGame();

        const state = useGameStore.getState();
        expect(state.replayMoves).toEqual([]);
        expect(state.battleSeed).toBeNull();
        expect(state.battleField).toBeNull();
    });
});
