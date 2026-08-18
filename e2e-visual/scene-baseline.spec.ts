import { test, expect, type Page } from '@playwright/test';

/**
 * Эталонные кадры боевой сцены на трёх пресетах неба (issue #585).
 *
 * ## Зачем
 *
 * До этого барьера визуальная регрессия сторожила только витрину `/design-system`,
 * а сама арена не проверялась ничем: правка отрисовки уезжала в прод зелёной. Так
 * проехал регресс тени #571 — на закате она вырождалась в полосу 594×2 px, её
 * поймал человек глазами через час после выката (#580, откат #581). Ни один
 * автоматический чек этого увидеть не мог: у сцены не было эталона.
 *
 * ## Чем держится детерминизм
 *
 * 1. **Сид боя** задаёт рельеф, ветер, пресет неба, положение светила и облаков.
 *    Сиды подобраны так, чтобы `pickSkyPreset` дал каждый из трёх пресетов —
 *    регресс #571 виден ТОЛЬКО на закате, кадр одного дневного боя его пропустил бы.
 * 2. **Часы страницы остановлены** (`page.clock.pauseAt`): Playwright подменяет
 *    `Date`, `performance.now` и `requestAnimationFrame`, поэтому кадр движка —
 *    чистая функция от суммы `runFor`, а не от того, как быстро машина сегодня
 *    считает.
 * 3. **Кадры цепляются за состояние движка, а не за миллисекунды**
 *    (`window.__gameDebug`, `game-debug.ts`): при разных сиде и ветре снаряд летит
 *    разное время, и фиксированное «снять на 2000-й мс» дало бы в одном пресете
 *    взрыв, а в другом — пустое небо (так и вышло на первой версии этой спеки).
 * 4. **`prefers-reduced-motion: reduce`** (конфиг): облака стоят, пунктир дуги
 *    не бежит, CSS-анимации HUD не попадают в кадр в случайной фазе.
 * 5. **Арт публикуется после `decode()`** (`whenDecoded`, `shared/lib/canvas`):
 *    иначе тон силуэта гор кешировался пустым и горы пропадали в ~трети загрузок.
 * 6. **Готовность проверяется, а не предполагается** (ревью #585): перед первым
 *    кадром спека ждёт `data-sky-ready` от слоя неба и `player !== null` от
 *    движка. Раньше здесь стоял `networkidle`, который про `decode` (он идёт уже
 *    после сети) не знает вовсе, — недетерминизм гасила бы ретрай-петля
 *    `toHaveScreenshot`, то есть ровно то, что запрещает `retries: 0`.
 *
 * ## Что в кадре
 *
 * СЦЕНА, а не экран: кадр обрезан по канвасу арены, две полосы хрома у краёв
 * (верхний HUD и палуба) закрыты маской (`MASKED_OVERLAYS`), разовые подсказки
 * погашены флагами (`HINT_SEEN_KEYS`) — их плашки сидят посреди арены, и маска
 * вырезала бы из кадра полосу рельефа. Иначе барьер сторожил бы ещё и хром боевого
 * экрана — слои, которые он своими не заявляет и чьи файлы не покрыты globs правила
 * `scene-visual-baseline.md`: правка текста палубы краснила бы пятнадцать тяжёлых
 * эталонов без подсказки на причину (ревью #585).
 *
 * Кадры снимаются только в образе `node:24` — `npm run test:visual`
 * (`scripts/visual-baseline.mjs`). Запуск этой спеки на хосте даст чужую
 * растеризацию шрифтов и красный тест: у эталонов среда одна.
 *
 * ## Правило обновления
 *
 * Правишь отрисовку сцены — обновляешь эталоны ТЕМ ЖЕ PR
 * (`npm run test:visual -- --update`), и обновлённые кадры смотрит человек.
 * Подробности — `docs/design-consistency-gate/scene-visual-baseline.md`.
 */

/** Момент, на котором стоят часы страницы. Важна не сама дата, а то, что она одна
 *  для всех прогонов. */
const CLOCK_START = new Date('2026-01-01T00:00:00Z');

/** Симулированное время после готовности боя до кадра старта: движку хватает на
 *  первую полную отрисовку сцены. */
const SETTLE_MS = 1000;

/** Один шаг симуляции — кадр rAF поддельных часов Playwright. */
const FRAME_MS = 16;

/** Потолок ожидания события движка в кадрах (≈8 с симуляции). Уперлись — тест
 *  красный: значит выстрел не долетел и кадр «взрыв» показал бы не взрыв. */
const MAX_FRAMES = 500;

/** Сколько кадров даём взрыву раскрыться, прежде чем снять его: первый кадр с
 *  живой частицей — это ещё точка удара, а не вспышка. */
const EXPLOSION_BLOOM_FRAMES = 24;

/**
 * Потолок ожидания осевшей земли в кадрах. Осыпание кратера идёт по 1 px за кадр
 * и на глубоком склоне тянется СОТНЯМИ кадров: на сиде `vrt-day-2` земля всё ещё
 * сыпалась на 300-м кадре, а рендерер под остановленными часами к тому моменту
 * падал («Target crashed»). Поэтому ждём осадку, но не бесконечно: кадр «после
 * взрыва» снимается либо когда земля осела, либо на этом потолке — в обоих
 * случаях это ФИКСИРОВАННОЕ число шагов симуляции, а не «сколько-то миллисекунд».
 */
const GROUND_SETTLE_CAP_FRAMES = 60;

/** Нажатий «стрелка влево» — поднимают ствол к −45°, лоб летит вправо к врагу.
 *  Общее для всех пресетов: рельеф у сидов разный, но стартовый угол один. */
const AIM_LEFT_PRESSES = 45;

/** Нажатий «стрелка вниз» — сбавляют мощность, чтобы снаряд лёг в рельеф в кадре,
 *  а не улетел за правый край (там взрыва не будет вовсе). Дефолт для пресетов без
 *  своего `downPresses` (см. `TScenePreset`). */
const AIM_DOWN_PRESSES = 4;

/**
 * Оверлеи, которые закрываем маской: барьер сторожит СЦЕНУ (то, что рисует канвас),
 * а кадр — прямоугольник страницы, и HUD с палубой попадают в него поверх арены
 * (ревью #585). Без маски правка текста палубы или подложки HUD краснила бы все
 * двенадцать тяжёлых эталонов, причём агенту, который её делает, правило
 * `scene-visual-baseline.md` даже не загрузилось бы: его globs — движок и арт.
 *
 * Список — ровно две полосы у краёв экрана, и это осознанный размен: всё, что
 * маска закрывает, из-под надзора уходит. Поэтому `arena-turn-ring` (рамка хода,
 * `inset-0` во всю арену) в него НЕ входит — маска по нему стёрла бы кадр целиком,
 * а разовые подсказки (`aim-hint`, `sound-hint-toast`) не маскируются, а гасятся
 * флагами: их плашки сидят посреди арены, и маска вырезала бы из кадра полосу
 * рельефа вместе с ними.
 */
const MASKED_OVERLAYS = ['top-hud', 'game-hud'] as const;

/**
 * Ключи разовых подсказок (`aim-hint.ts`, `sound-hint.ts`). Ставим их до захода,
 * чтобы снимать УСТОЯВШУЮСЯ сцену — как её видит игрок со второго боя. Литералами,
 * а не импортом из `src`: спека не должна тянуть в прогон React-модули ради двух
 * строк. Переименуют ключ — подсказки вернутся в кадр и барьер покраснеет, то есть
 * рассинхрон виден, а не молчалив.
 */
const HINT_SEEN_KEYS = ['pt-aim-hint-seen', 'pt-sound-hint-seen'];

type TSceneDebug = {
    player: { x: number; y: number; width: number; height: number } | null;
    bulletInFlight: boolean;
    particlesAlive: boolean;
    explosionActive: boolean;
    groundFalling: boolean;
};

/**
 * Пресет = сид, дающий нужный пресет неба. Сиды выбраны перебором по
 * `pickSkyPreset` (`sky-preset.ts`): пресет неба — функция сида, отдельного
 * параметра для него в бою нет. Что выбор действительно тот, проверяет
 * `expectSkyPreset` перед первым кадром, а не докблок.
 */
type TScenePreset = {
    id: 'day' | 'sunset' | 'night';
    seed: string;
    /**
     * Нажатий «стрелка вниз» ПЕРЕД выстрелом этого пресета — своя мощность вместо
     * общего `AIM_DOWN_PRESSES`, когда дефолт кладёт снаряд в дно долины между
     * холмами: там воронка проседает в уже низкий рельеф и не меняет силуэт в
     * кадре вовсе (issue #605 — на закате `scene-sunset-05-after.png` не показывал
     * попадание никак). `vrt-sunset-1` с мощностью 4 (дефолт) ложится ровно в такую
     * долину; с мощностью 5 снаряд не долетает до неё и режет воронку в гребень
     * ближнего холма — там кратер виден чётким сколом силуэта. (Мощность 6 режет
     * тот же склон, но укорачивает полёт до 17 кадров — короче 20-кадрового окна,
     * которое кадр «02-flight» ждёт ПОСЛЕ входа в полёт, и роняет его ассерт.)
     */
    downPresses: number;
};

const PRESETS: readonly TScenePreset[] = [
    { id: 'day', seed: 'vrt-day-2', downPresses: AIM_DOWN_PRESSES },
    { id: 'sunset', seed: 'vrt-sunset-1', downPresses: 5 },
    { id: 'night', seed: 'vrt-night-9', downPresses: AIM_DOWN_PRESSES },
];

/** Снимок состояния движка. Хук read-only и висит всегда, в том числе в прод-сборке. */
async function sceneDebug(page: Page): Promise<TSceneDebug> {
    const snapshot = await page.evaluate(() => window.__gameDebug?.getSnapshot() ?? null);
    if (!snapshot) throw new Error('window.__gameDebug недоступен — движок не инициализирован');
    return snapshot;
}

/**
 * Крутит симуляцию по одному кадру, пока не выполнится условие. Часы стоят,
 * поэтому «пока» считается в КАДРАХ, а не в реальном времени: сколько бы ни
 * заняла проверка условия, состояние сцены зависит только от числа шагов.
 */
async function stepUntil(
    page: Page,
    what: string,
    predicate: (debug: TSceneDebug) => boolean,
): Promise<number> {
    for (let frame = 1; frame <= MAX_FRAMES; frame++) {
        await page.clock.runFor(FRAME_MS);
        if (predicate(await sceneDebug(page))) return frame;
    }
    throw new Error(`Сцена не дошла до состояния «${what}» за ${MAX_FRAMES} кадров симуляции`);
}

/**
 * Шагает симуляцию, пока условие не выполнится ИЛИ не кончится бюджет кадров —
 * без красного теста на исчерпании. Для состояний, которые на одном рельефе
 * наступают за десяток кадров, а на другом не наступают вовсе (осыпание кратера).
 */
async function stepUpTo(
    page: Page,
    frames: number,
    predicate: (debug: TSceneDebug) => boolean,
): Promise<number> {
    for (let frame = 1; frame <= frames; frame++) {
        await page.clock.runFor(FRAME_MS);
        if (predicate(await sceneDebug(page))) return frame;
    }
    return frames;
}

/**
 * Доводит страницу боя до состояния «бой готов, часы стоят на нуле».
 *
 * Ожидания идут в РЕАЛЬНОМ времени при остановленных часах: гидрация React и
 * загрузка арта таймеров не ждут, а движок без `runFor` не делает ни шага. Поэтому
 * сколько бы реального времени ни занял заход, симулированное время старта одно.
 */
async function openBattle(page: Page, seed: string): Promise<void> {
    await page.clock.pauseAt(CLOCK_START);
    // Разовые подсказки помечаем увиденными ДО первого рендера: иначе их плашки
    // висят посреди арены и закрывают собой рельеф, ради которого кадр и снят.
    await page.addInitScript((keys) => {
        for (const key of keys) localStorage.setItem(key, '1');
    }, HINT_SEEN_KEYS);
    await page.goto(`/game?seed=${seed}`);
    await expect(page.getByTestId('game-hud')).toBeVisible();
    // Боезапас роздан — иначе ранние нажатия уходят в no-op.
    await expect(page.getByTestId('game-hud')).toHaveAttribute('data-weapons-remaining', /[1-9]/);
    // Небо: весь арт долетел И декодирован. Не `networkidle` (он про сеть, а
    // `whenDecoded` резолвится уже ПОСЛЕ неё, да и сам приём помечен discouraged) —
    // признак публикует сам слой неба, когда спрайты готовы к отрисовке.
    await expect(page.getByTestId('sky-canvas')).toHaveAttribute('data-sky-ready', 'true');
    // Движок: танки существуют только после `initPaint`, то есть после декода песка
    // и спрайтов скинов. До этого кадр «старт» показал бы пустой рельеф, и спасала
    // бы только ретрай-петля `toHaveScreenshot` — маскировка недетерминизма ровно
    // там, где конфиг её запрещает (`retries: 0`).
    await expect.poll(async () => (await sceneDebug(page)).player !== null).toBe(true);
    // `document.fonts.ready` резолвится несериализуемым `FontFaceSet` — гасим
    // значение, чтобы не зависеть от того, как его переварит сериализатор.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * Проверяет, что сид действительно дал ожидаемый пресет неба. Обязательны все три
 * (регресс тени #571 виден ТОЛЬКО на закате), а связь сид→пресет — внутренняя
 * деталь `pickSkyPreset`: без этой проверки правка хеша молча превратила бы
 * «ночной» бой в дневной, человек на пересъёмке увидел бы новый вид кадров, но не
 * то, что пресетов стало два (ревью #585).
 */
async function expectSkyPreset(page: Page, preset: TScenePreset): Promise<void> {
    await expect(page.getByTestId('sky-canvas')).toHaveAttribute('data-sky-preset', preset.id);
}

/** Прицеливается и стреляет клавиатурой — тем же путём ввода, что у игрока. */
async function aimAndFire(page: Page, downPresses: number): Promise<void> {
    for (let i = 0; i < AIM_LEFT_PRESSES; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < downPresses; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
}

/**
 * Снимает кадр СЦЕНЫ: обрез по канвасу арены и маска на оверлеях (`MASKED_OVERLAYS`).
 * Кадр всего вьюпорта сторожил бы заодно HUD, палубу и тосты — слои, которые барьер
 * не заявляет своими и чьи файлы не попадают под globs его правила.
 */
async function expectSceneShot(page: Page, name: string): Promise<void> {
    const clip = await page.getByTestId('game-canvas').boundingBox();
    if (!clip) throw new Error('канвас арены не найден — снимать нечего');
    await expect(page).toHaveScreenshot(name, {
        clip,
        mask: MASKED_OVERLAYS.map((testId) => page.getByTestId(testId)),
    });
}

for (const preset of PRESETS) {
    test(`боевая сцена · пресет неба «${preset.id}» · пять состояний`, async ({ page }) => {
        test.setTimeout(180_000);

        await openBattle(page, preset.seed);
        await expectSkyPreset(page, preset);

        await page.clock.runFor(SETTLE_MS);
        await expectSceneShot(page, `scene-${preset.id}-01-start.png`);

        await aimAndFire(page, preset.downPresses);

        // Полёт: снаряд в воздухе — ждём, пока движок его заведёт, и даём трассе
        // отрисоваться, чтобы в кадр попал не только снаряд, но и хвост следа.
        await stepUntil(page, 'снаряд в полёте', (d) => d.bulletInFlight);
        await page.clock.runFor(20 * FRAME_MS);
        expect((await sceneDebug(page)).bulletInFlight).toBe(true);
        await expectSceneShot(page, `scene-${preset.id}-02-flight.png`);

        // Взрыв: первый кадр с живыми частицами. Не долетел до земли — красный тест,
        // а не тихий кадр пустого неба под именем «explosion».
        await stepUntil(page, 'взрыв', (d) => d.particlesAlive);
        await page.clock.runFor(EXPLOSION_BLOOM_FRAMES * FRAME_MS);
        await expectSceneShot(page, `scene-${preset.id}-03-explosion.png`);

        // Догорание: частицы уже погасли, но снаряд ещё не убран — движок идёт по
        // ветке `explosionAreaRedraw` + `redrawGroundUnderTanks` (`GamePlay.animate`,
        // `bullet.detonated` без `particlesAlive`), а не по `fullRedraw`, как в двух
        // соседних кадрах. Ровно этот путь эталоны не сторожили до issue #605 — PR
        // #601 (фиксы #580/#582) не сдвинул ни одного пикселя ни в одном из
        // четырёх прежних кадров, хотя чинил именно вид. Явный ассерт на
        // `explosionActive`, а не только имя кадра: если тайминг когда-нибудь
        // сойдётся (частицы станут гаснуть позже конца вспышки), кадр молча
        // перестанет проверять эту ветку — тест должен покраснеть, а не смолчать.
        await stepUntil(page, 'частицы догорели', (d) => !d.particlesAlive);
        expect((await sceneDebug(page)).explosionActive).toBe(true);
        await expectSceneShot(page, `scene-${preset.id}-04-fading.png`);

        // После взрыва: очаг вспышки закрылся, земля осыпалась в воронку — с
        // потолком в кадрах, на пологом рельефе осадка идёт сотнями кадров
        // (см. `GROUND_SETTLE_CAP_FRAMES`). Фиксированное число шагов симуляции,
        // а не «подождём 800 мс» (ревью #585).
        await stepUntil(page, 'взрыв догорел', (d) => !d.explosionActive);
        await stepUpTo(page, GROUND_SETTLE_CAP_FRAMES, (d) => !d.groundFalling);
        await expectSceneShot(page, `scene-${preset.id}-05-after.png`);
    });
}
