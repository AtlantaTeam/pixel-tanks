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

/**
 * Ветка перерисовки кадра (issue #605, ревью PR фазы): чем движок рисовал
 * последний кадр — целиком (`full`) или точечно. Кадр «частицы догорели»
 * держится ровно на том, что сцена идёт ТОЧЕЧНОЙ полосой взрыва
 * (`GamePlay.explosionAreaRedraw`, #582), а не `fullRedraw`; условий для этого
 * в движке три (`particlesAlive`, `shakeActive`, наличие сдетонировавшего
 * снаряда — `GamePlay.animate`), и сверять их снаружи по одному значит
 * сторожить кадр косвенными признаками: вырастет время жизни частиц или
 * длительность тряски — кадр молча вернётся на `fullRedraw`, а эталон
 * переснимут. Поэтому наружу отдаётся сам факт ветки.
 *
 * `none` — кадр ещё ни разу не рисовался (движок только создан).
 */
export type TGameDebugRedraw = 'none' | 'full' | 'explosion-area' | 'ground-fall' | 'tanks';

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
    /**
     * Радиус текущего очага вспышки (`bullet.explosionRadius`, 0 — очага нет или
     * он между сменой очагов кластера). Кадру «частицы догорели» (issue #605) мало
     * булева `explosionActive`: тот держится и в первый кадр после смерти частиц,
     * когда сцена только что вышла из чистого `fullRedraw` и точечная перерисовка
     * (`GamePlay.explosionAreaRedraw`, #582) ещё не успела дать грязь — измерено,
     * что именно на этом кадре откат #582 остаётся зелёным. Радиус даёт кадру
     * зацепиться за момент, когда очаг ЕЩЁ растёт (радиус > 0), то есть точечная
     * перерисовка уже отработала минимум один раз поверх собственного предыдущего
     * кадра, а не поверх чистого фона.
     */
    explosionRadius: number;
    /** Ветка, которой отрисован последний кадр — см. `TGameDebugRedraw`. */
    lastRedraw: TGameDebugRedraw;
};

/** Минимальная структурная форма `GamePlay`, которой достаточно для снапшота —
 *  не тянет весь класс движка в тестируемую единицу.
 *
 *  Необязательны здесь только те поля, которых у движка в моменте может не быть
 *  (танки до `initPaint`, снаряд вне выстрела). Поля ВНУТРИ них обязательны:
 *  `Bullet.explosionRadius` и `GamePlay.lastRedraw` существуют всегда, и `?` на
 *  них означал бы «может исчезнуть» — тогда переименование поля движка утекало бы
 *  в снапшот молча (0 / `none` вместо ошибки тайпчека), а VRT-ассерт краснел бы
 *  как «кадр не тот», а не как «поля больше нет» (ревью PR фазы). */
export type TGameDebugSource = {
    leftTank?: { bodyRect(): TGameDebugRect };
    rightTank?: { bodyRect(): TGameDebugRect };
    bullet?: { detonated: boolean; explosionRadius: number };
    ground?: { isFalling: boolean };
    /** Ветка перерисовки последнего кадра движка (`GamePlay.lastRedraw`). */
    lastRedraw: TGameDebugRedraw;
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
        explosionRadius: game.bullet?.explosionRadius ?? 0,
        lastRedraw: game.lastRedraw,
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
