import { create } from 'zustand';
import type { TReplayMove } from '@/entities/replays';
import type { TWeapon } from '@/shared/model';
import { MAX_HP, MOVE_BUDGET } from '@/shared/config';
import { EMPTY_ARENA_INSETS, type TArenaInsets } from '../lib/arena-insets';
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
    /**
     * Счётчик смен ветра бурей (#547): движок дёргает `announceWindShift` в момент
     * смены, плашка `WindShiftBanner` показывается на каждый инкремент. Число, а не
     * `boolean` — чтобы повторная смена (теоретически) снова разбудила плашку по
     * смене значения. Обнуляется в `startGame`/`resetGame` (новый бой — без плашки).
     */
    windShiftNonce: number;
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
    /**
     * Инсеты safe-зоны, под которые сгенерирован рельеф текущего боя (issue #454).
     * Пишутся в реплей вместе с размером поля: рельеф генерится ВНУТРИ свободной
     * зоны, поэтому без инсетов воспроизведение получило бы другой рельеф и другой
     * счёт. Ставятся движком в `onFieldInit` (те инсеты, что были активны в момент
     * генерации), сбрасываются в `startGame`/`resetGame` как и `battleField`.
     */
    battleInsets: TArenaInsets | null;
    /** Ходы игрока текущего боя в порядке совершения (см. `@/entities/replays`). */
    replayMoves: TReplayMove[];
    /**
     * Фактические высоты оверлеев, закрывающих арену сверху (HUD) и снизу
     * (палуба), CSS-пиксели — **единственный источник правды по инсетам арены**
     * (контракт safe-зоны, issue #453). Оба оверлея публикуют сюда свою высоту
     * через `ResizeObserver` (хук `useArenaInset`), движок читает и хранит
     * производную свободную зону (см. `arena-insets.ts`, `GamePlay.setArenaInsets`).
     * Не сбрасывается в `startGame`/`resetGame`: инсеты — свойство раскладки
     * смонтированных оверлеев, а не состояние боя; их жизненным циклом владеет сам
     * хук (публикует на монтировании, обнуляет на размонтировании).
     */
    arenaInsets: TArenaInsets;
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
    /**
     * Запоминает ветер боя. Движок зовёт при старте боя (`onWindInit`) и на смене
     * ветра бурей в середине боя (`onWindChange`, #547) — во втором случае вместе с
     * `announceWindShift`, чтобы HUD и обновил значение, и показал плашку.
     */
    setWind: (wind: number) => void;
    /** Отмечает смену ветра бурей (#547): плашка `WindShiftBanner` реагирует на инкремент. */
    announceWindShift: () => void;
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
    /** Записывает размер поля и инсеты safe-зоны боя (движок зовёт в `onFieldInit`). */
    setBattleField: (width: number, height: number, insets: TArenaInsets) => void;
    recordMove: (delta: number) => void;
    /**
     * Записывает выстрел игрока в реплей и считает его для статистики конца боя:
     * `shotsFired` по построению равен числу ходов `kind: 'fire'`, поэтому счётчик
     * инкрементится здесь же — один источник истины, рассинхрон невозможен.
     *
     * `weaponId` — ординал типа оружия (`WEAPON_KIND_ORDER`, issue #483). Фугас (0)
     * или отсутствие в реплей не пишется — запись остаётся совместимой со старыми.
     */
    recordFire: (angle: number, power: number, weaponId?: number) => void;
    /**
     * Публикует фактическую высоту одного оверлея (верхнего HUD или нижней
     * палубы) в инсеты арены. Обновляет ровно одну грань, не трогая соседнюю —
     * оверлеи независимы и измеряются каждый своим `ResizeObserver`. Запись
     * той же высоты — no-op (ссылка `arenaInsets` не меняется), чтобы лишний
     * тик `ResizeObserver` не будил подписчиков (`GameCanvas`).
     */
    setArenaInset: (edge: keyof TArenaInsets, height: number) => void;
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
    windShiftNonce: 0,
    hits: 0,
    isGameOver: false,
    finalHp: null,
    finalStats: null,
    battleSeed: null,
    battleField: null,
    battleInsets: null,
    replayMoves: [],
    arenaInsets: EMPTY_ARENA_INSETS,

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
    announceWindShift: () => set((s) => ({ windShiftNonce: s.windShiftNonce + 1 })),
    fire: () => set((s) => (s.phase !== 'aiming' ? {} : { phase: 'flight', windRevealed: true })),
    recordPlayerHit: () => set((s) => ({ hits: s.hits + 1 })),
    setWeapons: (weapons) => set({ weapons }),
    selectWeapon: (selectedWeapon) => set({ selectedWeapon }),
    removeWeaponById: (id) =>
        set((s) => {
            const weapons = s.weapons.filter((w) => w.id !== id);
            const removed = s.selectedWeapon;
            // Выстрелянное оружие было выбранным — по возможности сохраняем выбор
            // ТОГО ЖE типа, если он ещё есть в арсенале (неоднородный арсенал #483):
            // выстрелив осознанно выбранным Кластером, игрок не должен на следующий
            // ход обнаружить откат выбора к Фугасу. Своего типа не осталось — берём
            // первый оставшийся, как и раньше.
            const selectedWeapon =
                removed?.id === id
                    ? (weapons.find((w) => w.kind === removed.kind) ?? weapons[0] ?? null)
                    : s.selectedWeapon;
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
            windShiftNonce: 0,
            hits: 0,
            finalHp: null,
            finalStats: null,
            // Рематч через startGame стартует чистую запись: без сброса реплей
            // нового боя унаследовал бы ходы предыдущего (склеенная ссылка).
            battleSeed: null,
            battleField: null,
            battleInsets: null,
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
            windShiftNonce: 0,
            hits: 0,
            isGameOver: false,
            finalHp: null,
            finalStats: null,
            battleSeed: null,
            battleField: null,
            battleInsets: null,
            replayMoves: [],
        }),
    setBattleSeed: (battleSeed) => set({ battleSeed }),
    setBattleField: (width, height, insets) =>
        set({ battleField: { width, height }, battleInsets: insets }),
    recordMove: (delta) =>
        set((s) => ({ replayMoves: [...s.replayMoves, { kind: 'move', delta }] })),
    recordFire: (angle, power, weaponId) =>
        set((s) => ({
            replayMoves: [
                ...s.replayMoves,
                // Пишем `weaponId` ровно по той же семантике, что и `encodeReplay`
                // (гейт `weaponId > 0`): фугас (0) и отсутствие типа не пишем —
                // запись остаётся совместимой со старыми. Явное `> 0` вместо
                // truthiness ещё и отсекает случайный `-1` (kind вне
                // `WEAPON_KIND_ORDER`), который иначе как `weaponId:-1` дошёл бы до
                // кодека и уронил бы `encodeReplay` в конце боя — далеко от причины.
                weaponId !== undefined && weaponId > 0
                    ? { kind: 'fire', angle, power, weaponId }
                    : { kind: 'fire', angle, power },
            ],
            shotsFired: s.shotsFired + 1,
        })),
    setArenaInset: (edge, height) =>
        set((s) =>
            s.arenaInsets[edge] === height
                ? {}
                : { arenaInsets: { ...s.arenaInsets, [edge]: height } },
        ),
}));
