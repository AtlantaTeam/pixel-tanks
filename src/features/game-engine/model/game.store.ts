import { create } from 'zustand';
import type { TReplayMove } from '@/entities/replays';
import type { TWeapon } from '@/shared/model';
import { MAX_HP, MOVE_BUDGET } from '@/shared/config';
import { clampPower } from '../lib/power';

// Геймдизайн-константы боя (GDD §2.3/§2.5) живут в `shared/config` — общий
// источник для стора, статистики боя и потолка очков лидерборда (см. там же).
// Реэкспортим, чтобы не менять существующие импорты внутри `game-engine`.
export { MAX_HP, MOVE_BUDGET };

/** Сторона боя, по которой адресуются HP и урон. Левый танк — игрок, правый — бот. */
export type TSide = 'player' | 'enemy';

/**
 * Фаза хода — по ней экран блокирует ввод и подписывает лок (handoff «Состояние»):
 * `idle` — покой, боя нет; `aiming` — ход игрока, можно целиться и стрелять;
 * `flight` — снаряд в полёте; `resolving` — попадание оседает; `over` — бой окончен.
 *
 * Фазовая машина подключена к боевому пути: `GameCanvas` зовёт `startGame` на
 * старте боя (→ `aiming`), `fire` на старте выстрела (→ `flight`, раскрывает
 * ветер) и возвращает фазу в `aiming` по завершении полёта. Поэтому в живой игре
 * `phase` проходит `aiming`→`flight`→`aiming`, а `windRevealed` становится
 * `true` после первого выстрела — на это и опираются e2e-барьеры геометрии HUD.
 */
export type TPhase = 'idle' | 'aiming' | 'flight' | 'resolving' | 'over';

/** Исход законченного боя. Выводится из HP (не из очков) — см. `deriveOutcome`. */
export type TBattleOutcome = 'victory' | 'defeat' | 'draw';

/** Держит HP в границах боя: не ниже 0 и не выше максимума. */
const clampHp = (hp: number) => Math.min(MAX_HP, Math.max(0, hp));

/**
 * Исход боя по HP: победа — если у игрока HP больше, поражение — если меньше,
 * ничья — при равенстве (например, кончились снаряды при равном HP). Победа по
 * `hp <= 0` — частный случай сравнения: у убитого танка HP наименьший. Чистая
 * функция; исход в state стор не хранит — единственный потребитель `deriveOutcome`
 * сейчас `GameOverDialog` (считает по снимку `finalHp`).
 */
export const deriveOutcome = (playerHp: number, enemyHp: number): TBattleOutcome =>
    playerHp > enemyHp ? 'victory' : playerHp < enemyHp ? 'defeat' : 'draw';

/**
 * Ход бота: соперник ходит и бой ещё не окончен. Маджента-тема/рамка арены
 * держится весь ход соперника — включая полёт его снаряда (`turn` не флипается
 * обратно, пока снаряд бота не долетит); на финале снята, его темизирует
 * `GameOverDialog`. Единая точка правды предиката «ход бота» для `game-page`
 * (тема корня), `game-canvas` (рамка арены) и `game-controls` (лок палубы) —
 * при правке фазовой машины (новая фаза и т.п.) копии не разъедутся.
 */
export const selectIsBotTurn = (s: Pick<TGameState, 'turn' | 'phase'>): boolean =>
    s.turn === 'enemy' && s.phase !== 'over';

/**
 * Показывать тост «патроны кончились» (issue #448): свой ход в фазе прицеливания,
 * без снарядов. Манёвр остаётся активным — тост только предупреждает про огонь,
 * не блокирует ход. Источник для `AmmoEmptyToast` (собственный слой поверх арены).
 * Дизейбл кнопки ОГОНЬ в `game-controls` считается отдельно (`canFire`) — там
 * условие шире (свой ход И есть снаряды), а не только «патроны кончились».
 *
 * Гард — позитивный (`phase === 'aiming'`), а не перечисление исключаемых фаз:
 * дефолтное состояние стора (`phase: 'idle'`, `turn: 'player'`, `weapons: []`)
 * рендерится на входе в бой ДО того, как эффект `GameCanvas` вызовет
 * `startGame`+`setWeapons`. При `phase !== 'flight' && phase !== 'over'` тост
 * вспыхнул бы на один кадр (`idle` проходит фильтр); `phase === 'aiming'` это
 * закрывает и заодно отсекает пока не используемую фазу `resolving`.
 */
export const selectShowAmmoEmptyToast = (
    s: Pick<TGameState, 'turn' | 'phase' | 'weapons'>,
): boolean => s.turn === 'player' && s.phase === 'aiming' && s.weapons.length === 0;

/**
 * Показывать подсказку жеста «тяни по арене — отпусти, чтобы выстрелить»
 * (issue #451): до первого выстрела ТЕКУЩЕГО боя, дальше скрыта — новичку
 * подсказка нужна один раз, а не постоянной строкой в компактной палубе.
 *
 * Источник — `shotsFired` (стор, не локальный `useState` палубы): счётчик
 * считает только выстрелы игрока (`recordFire`) и обнуляется в `startGame`/
 * `resetGame`, поэтому подсказка переживает ремаунт `GameControls` внутри
 * одного боя и появляется заново в следующем — ровно то, что требует критерий
 * готовности.
 */
export const selectShowGestureHint = (s: Pick<TGameState, 'shotsFired'>): boolean =>
    s.shotsFired === 0;

type TGameState = {
    angle: number;
    power: number;
    moves: number;
    /** HP сторон (0..MAX_HP). Заменяют очковую модель: попадание снимает урон. */
    hp: { player: number; enemy: number };
    /** Чей сейчас ход — верхний HUD красит пилюлю и глушит телеметрию по ней. */
    turn: TSide;
    /**
     * Ветер боя (px/тик², как `GamePlay.wind`): постоянный, задаётся один раз при
     * старте боя (`onWindInit`). До первого выстрела HUD показывает только грубую
     * силу (пипы), после — точное значение (см. `windRevealed`).
     */
    wind: number;
    weapons: TWeapon[];
    selectedWeapon: TWeapon | null;
    /** Фаза хода — экран лочит ввод по ней (см. `TPhase`). */
    phase: TPhase;
    /**
     * Ветер раскрыт точным числом. До первого выстрела игрок видит только
     * стрелку и грубую силу (GDD: первый выстрел — пристрелка); после — точное
     * значение до конца боя.
     */
    windRevealed: boolean;
    /** Сколько раз игрок выстрелил — для статистики экрана конца боя. */
    shotsFired: number;
    /** Сколько выстрелов игрока попали по противнику — для точности game-over. */
    hits: number;
    isGameOver: boolean;
    /**
     * Снимок HP на переходе isGameOver false→true. Пока последние кадры боя
     * «оседают», hp может ещё чуть измениться — исход законченной игры
     * фиксируется один раз и не должен от этого дрожать (#337).
     */
    finalHp: { player: number; enemy: number } | null;
    /**
     * Снимок входов статистики (выстрелы/попадания/манёвры) на том же переходе
     * isGameOver false→true, что и `finalHp`. Симметрично снимку HP: диалог конца
     * боя и отправленные в лидерборд очки читают ЗАМОРОЖЕННУЮ статистику, чтобы
     * показанное совпало с отправленным, даже если стор ещё дрогнет (#337).
     */
    finalStats: { shots: number; hits: number; maneuvers: number } | null;
    /** Seed текущего боя — нужен для сборки ссылки-реплея после его окончания. */
    battleSeed: number | string | null;
    /**
     * Логический размер поля текущего боя (CSS-пиксели). Записывается в реплей:
     * без него воспроизведение на другом экране даст другой рельеф и счёт.
     */
    battleField: { width: number; height: number } | null;
    /** Ходы игрока текущего боя в порядке совершения (см. `@/entities/replays`). */
    replayMoves: TReplayMove[];
};

type TGameActions = {
    setAngle: (angle: number) => void;
    increaseAngle: (delta: number) => void;
    setPower: (power: number) => void;
    increasePower: (delta: number) => void;
    decrementMoves: () => void;
    /**
     * Наносит урон стороне: HP цели уменьшается на `amount`, зажатый в 0..MAX_HP.
     * По умолчанию добивание (HP ≤ 0) заканчивает бой по HP. `endsBattle: false`
     * (режим реплея) снимает урон, но НЕ ставит isGameOver: конец записи ставит
     * драйвер по `isFinished`, иначе старая ссылка (суммарный урон стороне > MAX_HP
     * по правилам до HP-модели) оборвала бы воспроизведение на середине ленты ходов.
     */
    applyDamage: (target: TSide, amount: number, endsBattle?: boolean) => void;
    setPhase: (phase: TPhase) => void;
    /** Меняет сторону хода (движок зовёт при старте боя и на каждой передаче хода). */
    setTurn: (turn: TSide) => void;
    /** Запоминает ветер боя (движок зовёт один раз при старте боя). */
    setWind: (wind: number) => void;
    /**
     * Выстрел в фазовой машине: только из фазы прицеливания (`aiming`), переводит
     * в полёт и раскрывает ветер. `GameCanvas` зовёт её на старте любого выстрела
     * (`onShotStart` — и игрока, и бота: у обоих это переход `aiming`→`flight`).
     * Счёт выстрелов для статистики ведёт `recordFire` (единый с записью реплея).
     */
    fire: () => void;
    /** Считает попадание игрока по противнику для точности конца боя. */
    recordPlayerHit: () => void;
    setWeapons: (weapons: TWeapon[]) => void;
    selectWeapon: (weapon: TWeapon) => void;
    removeWeaponById: (id: number) => void;
    /** Помечает бой законченным и фиксирует снимки HP/статистики (переход false→true). */
    setGameOver: () => void;
    startGame: () => void;
    resetGame: () => void;
    setBattleSeed: (seed: number | string) => void;
    setBattleField: (width: number, height: number) => void;
    recordMove: (delta: number) => void;
    /**
     * Записывает выстрел игрока в реплей и считает его для статистики конца боя:
     * `shotsFired` по построению равен числу ходов `kind: 'fire'`, поэтому счётчик
     * инкрементится здесь же — один источник истины, рассинхрон невозможен.
     */
    recordFire: (angle: number, power: number) => void;
};

const fullHp = () => ({ player: MAX_HP, enemy: MAX_HP });

/** Снимок входов статистики на конце боя — симметрично `finalHp` (#337). */
const snapshotStats = (s: TGameState) => ({
    shots: s.shotsFired,
    hits: s.hits,
    maneuvers: MOVE_BUDGET - s.moves,
});

export const useGameStore = create<TGameState & TGameActions>((set) => ({
    angle: 0,
    power: 10,
    moves: MOVE_BUDGET,
    hp: fullHp(),
    turn: 'player',
    wind: 0,
    weapons: [],
    selectedWeapon: null,
    phase: 'idle',
    windRevealed: false,
    shotsFired: 0,
    hits: 0,
    isGameOver: false,
    finalHp: null,
    finalStats: null,
    battleSeed: null,
    battleField: null,
    replayMoves: [],

    setAngle: (angle) => set({ angle }),
    increaseAngle: (delta) => set((s) => ({ angle: s.angle + delta })),
    setPower: (power) => set({ power: clampPower(power) }),
    increasePower: (delta) => set((s) => ({ power: clampPower(s.power + delta) })),
    decrementMoves: () => set((s) => ({ moves: s.moves - 1 })),
    applyDamage: (target, amount, endsBattle = true) =>
        set((s) => {
            const hp = { ...s.hp, [target]: clampHp(s.hp[target] - amount) };
            // Танк добит — бой окончен по HP (не по очкам). Исход фиксируется
            // один раз: снимки HP и статистики держат его стабильным на
            // «оседающих» кадрах (#337). В режиме реплея (`endsBattle: false`)
            // конец ставит драйвер по концу ленты ходов, а не добивание по HP.
            if (endsBattle && (hp.player <= 0 || hp.enemy <= 0) && !s.isGameOver) {
                return {
                    hp,
                    isGameOver: true,
                    phase: 'over',
                    finalHp: hp,
                    finalStats: snapshotStats(s),
                };
            }
            return { hp };
        }),
    setPhase: (phase) => set({ phase }),
    setTurn: (turn) => set({ turn }),
    setWind: (wind) => set({ wind }),
    fire: () => set((s) => (s.phase !== 'aiming' ? {} : { phase: 'flight', windRevealed: true })),
    recordPlayerHit: () => set((s) => ({ hits: s.hits + 1 })),
    setWeapons: (weapons) => set({ weapons }),
    selectWeapon: (selectedWeapon) => set({ selectedWeapon }),
    removeWeaponById: (id) =>
        set((s) => {
            const weapons = s.weapons.filter((w) => w.id !== id);
            const selectedWeapon =
                s.selectedWeapon?.id === id ? (weapons[0] ?? null) : s.selectedWeapon;
            return { weapons, selectedWeapon };
        }),
    setGameOver: () =>
        set((s) =>
            s.isGameOver
                ? {}
                : {
                      isGameOver: true,
                      phase: 'over',
                      finalHp: s.hp,
                      finalStats: snapshotStats(s),
                  },
        ),
    startGame: () =>
        set({
            isGameOver: false,
            hp: fullHp(),
            moves: MOVE_BUDGET,
            turn: 'player',
            wind: 0,
            phase: 'aiming',
            windRevealed: false,
            shotsFired: 0,
            hits: 0,
            finalHp: null,
            finalStats: null,
            // Рематч через startGame стартует чистую запись: без сброса реплей
            // нового боя унаследовал бы ходы предыдущего (склеенная ссылка).
            battleSeed: null,
            battleField: null,
            replayMoves: [],
        }),
    resetGame: () =>
        set({
            angle: 0,
            power: 10,
            moves: MOVE_BUDGET,
            hp: fullHp(),
            turn: 'player',
            wind: 0,
            weapons: [],
            selectedWeapon: null,
            phase: 'idle',
            windRevealed: false,
            shotsFired: 0,
            hits: 0,
            isGameOver: false,
            finalHp: null,
            finalStats: null,
            battleSeed: null,
            battleField: null,
            replayMoves: [],
        }),
    setBattleSeed: (battleSeed) => set({ battleSeed }),
    setBattleField: (width, height) => set({ battleField: { width, height } }),
    recordMove: (delta) =>
        set((s) => ({ replayMoves: [...s.replayMoves, { kind: 'move', delta }] })),
    recordFire: (angle, power) =>
        set((s) => ({
            replayMoves: [...s.replayMoves, { kind: 'fire', angle, power }],
            shotsFired: s.shotsFired + 1,
        })),
}));
