/**
 * Read-only debug-хук движка для e2e (issue #456, расширен #585).
 *
 * Танки рисуются на canvas — у них нет DOM-узла, который Playwright мог бы
 * замерить `boundingBox()`. `bodyRect()` (`tank.ts`) — единственный источник
 * прямоугольника корпуса (рендер и хит-зона), поэтому именно его и отдаём
 * наружу через `window.__gameDebug`, не дублируя геометрию.
 *
 * Хук **не даёт мутировать состояние** (только чтение снапшота) и висит
 * всегда, а не только в dev: прод-гейт гоняет e2e против прод-сборки
 * (`next start`, см. `playwright.config.ts`), поэтому фича, спрятанная за
 * `NODE_ENV !== 'production'`, была бы невидима ровно там, где барьер должен
 * её проверять.
 */

export type TGameDebugRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type TGameDebugSnapshot = {
    player: TGameDebugRect | null;
    enemy: TGameDebugRect | null;
    /**
     * Снаряд в воздухе: объект есть и он ещё не сдетонировал. Фаза боя,
     * а не пиксель: эталонные кадры сцены (issue #585) цепляются за состояние
     * движка, а не за угаданные миллисекунды — при разных сиде и ветре снаряд
     * летит разное время, и «снять кадр на 500-й мс» означало бы разный смысл
     * кадра в разных пресетах неба.
     */
    bulletInFlight: boolean;
    /** Взрыв в кадре: живы частицы (комья земли / вспышка урона). */
    particlesAlive: boolean;
    /**
     * Очаг взрыва ещё растёт: снаряд сдетонировал, но объект жив и рисует вспышку
     * (`bullet.ts`). Частицы к этому моменту могут уже догореть, поэтому кадр
     * «после взрыва» ждёт именно этот флаг — иначе в него попадала бы вспышка,
     * а не воронка (ревью #585).
     */
    explosionActive: boolean;
    /** Земля осыпается в воронку после взрыва. */
    groundFalling: boolean;
};

/** Минимальная структурная форма `GamePlay`, которой достаточно для снапшота —
 *  не тянет весь класс движка в тестируемую единицу. */
type TGameDebugSource = {
    leftTank?: { bodyRect(): TGameDebugRect };
    rightTank?: { bodyRect(): TGameDebugRect };
    bullet?: { detonated: boolean };
    ground?: { isFalling: boolean };
    /** Узкий геттер движка вместо всего пула частиц (ревью #585): снапшоту нужен
     *  один булев факт, а публичный `ParticlePool` открыл бы отсюда и спавн, и
     *  сброс — read-only контракт хука держим формой источника, а не уговором. */
    hasAliveParticles?: boolean;
};

declare global {
    interface Window {
        __gameDebug?: { getSnapshot: () => TGameDebugSnapshot | null };
    }
}

export function buildGameDebugSnapshot(game: TGameDebugSource): TGameDebugSnapshot {
    return {
        player: game.leftTank ? game.leftTank.bodyRect() : null,
        enemy: game.rightTank ? game.rightTank.bodyRect() : null,
        bulletInFlight: Boolean(game.bullet && !game.bullet.detonated),
        particlesAlive: Boolean(game.hasAliveParticles),
        explosionActive: Boolean(game.bullet?.detonated),
        groundFalling: Boolean(game.ground?.isFalling),
    };
}

export function installGameDebugHook(getGame: () => TGameDebugSource | null): void {
    window.__gameDebug = {
        getSnapshot: () => {
            const game = getGame();
            return game ? buildGameDebugSnapshot(game) : null;
        },
    };
}

export function uninstallGameDebugHook(): void {
    delete window.__gameDebug;
}
