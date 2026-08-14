import { createSeededRandom } from '@/shared/lib/random';
import type { TPrecipPresetId } from './precipitation';
import { generateWind, MAX_WIND } from './wind';

/**
 * Погода как игровой модификатор (#547, §7.8 разбора #534). Осадки (#546) сами по
 * себе — декор, который платит FPS и читаемостью трассы; здесь каждый пресет
 * получает одно-два **числовых** следствия для боя, а не только вид:
 *
 *  - **снег** — базовый ветер сильнее на треть (`windMultiplier = 4/3`): та же
 *    рогатка, другая поправка на снос;
 *  - **дождь** — кратеры темнее (`craterDarkenAlpha`) и край воронки на 1 px мягче
 *    (`craterEdgeSoftenPx`): рельеф «оплывает», читается как размокший;
 *  - **буря** — ветер один раз меняется в середине боя (`windShiftsMidBattle`), о
 *    смене сообщает плашка статуса (`WindShiftBanner`).
 *
 * Всё выводится из сида боя (пресет — `pickPrecipPreset`, следствия — эта таблица),
 * поэтому один сид → одна погода → один ход боя, и реплей воспроизводится побитово
 * (та же гарантия, что у рельефа и ветра). Таблица `WEATHER_MODIFIERS` зафиксирована
 * тестом (`weather-modifiers.test.ts`) — критерий #547: баланс не должен разъехаться
 * молча.
 *
 * Модель чистая и детерминирована: ни рисования, ни доступа к стору. Движок
 * (`game-play.ts`) применяет её при генерации ветра и при рендере кратеров; HUD —
 * при смене ветра бури.
 */
export type TWeatherModifier = {
    /**
     * Множитель базового ветра боя. Снег усиливает на треть (`4/3`), остальные
     * пресеты не трогают (`1`). Домножается на уже сгенерированный ветер, поэтому
     * не тратит лишний `random()` и не сдвигает последовательность боя (детерминизм
     * реплея). Итог может превысить `MAX_WIND` — физика это допускает, а шкала HUD
     * зажимает показ (`windMagnitude`).
     */
    windMultiplier: number;
    /**
     * Затемнение воронок (дождь): альфа тёмного слоя поверх столбцов рельефа, где
     * был кратер. `0` — без затемнения. Размокший песок в воронке темнее сухого.
     */
    craterDarkenAlpha: number;
    /**
     * Смягчение края воронки, CSS-пиксели (дождь: `1`). На столько пикселей по
     * краям затемнения альфа спадает — рельеф «оплывает», а не обрывается резко.
     * `0` — жёсткий край (без осадков-дождя).
     */
    craterEdgeSoftenPx: number;
    /**
     * Ветер меняется один раз в середине боя (буря). Новое значение выводится из
     * сида (`stormShiftedWind`), момент смены — фиксированный номер выстрела
     * (`STORM_WIND_SHIFT_AFTER_SHOTS`), поэтому смена одинакова в живом бою и в
     * реплее. `false` — ветер боя постоянен.
     */
    windShiftsMidBattle: boolean;
};

/** Снег усиливает базовый ветер на треть (§7.8): та же рогатка, больше поправка. */
export const SNOW_WIND_MULTIPLIER = 4 / 3;

/**
 * Таблица «пресет → модификатор» (§7.8). ЕДИНЫЙ источник числовых следствий погоды.
 * Зафиксирована тестом `weather-modifiers.test.ts` — правка любого числа обязана
 * пройти через обновление теста, иначе баланс разъедется молча (критерий #547).
 */
export const WEATHER_MODIFIERS: Readonly<Record<TPrecipPresetId, TWeatherModifier>> = {
    clear: {
        windMultiplier: 1,
        craterDarkenAlpha: 0,
        craterEdgeSoftenPx: 0,
        windShiftsMidBattle: false,
    },
    rain: {
        windMultiplier: 1,
        // Размокший песок в воронке заметно темнее сухого (~28%).
        craterDarkenAlpha: 0.28,
        // Край воронки «оплывает» на 1 px (§7.8).
        craterEdgeSoftenPx: 1,
        windShiftsMidBattle: false,
    },
    snow: {
        windMultiplier: SNOW_WIND_MULTIPLIER,
        craterDarkenAlpha: 0,
        craterEdgeSoftenPx: 0,
        windShiftsMidBattle: false,
    },
    sandstorm: {
        windMultiplier: 1,
        craterDarkenAlpha: 0,
        craterEdgeSoftenPx: 0,
        windShiftsMidBattle: true,
    },
};

/** Дефолт — «без погоды» (пресет не выведен: тесты/реплей без сида): бой как до #547. */
export const NEUTRAL_WEATHER_MODIFIER: TWeatherModifier = WEATHER_MODIFIERS.clear;

/**
 * Модификатор по идентификатору пресета. `undefined` (сид не передан) → нейтральный
 * модификатор, чтобы движок без сида вёл себя ровно как до #547.
 */
export const weatherModifierFor = (id: TPrecipPresetId | undefined): TWeatherModifier =>
    id ? WEATHER_MODIFIERS[id] : NEUTRAL_WEATHER_MODIFIER;

/** Базовый ветер с поправкой пресета (снег +1/3). Домножение, не новый `random()`. */
export const applyWindModifier = (wind: number, modifier: TWeatherModifier): number =>
    wind * modifier.windMultiplier;

/**
 * Номер завершённого выстрела (считая обе стороны), после которого буря один раз
 * меняет ветер. Фиксированное число — «середина боя» детерминированно: одинаково в
 * живом бою и в реплее (бот детерминирован сидом, ходы игрока записаны). Короткий
 * бой может закончиться раньше — тогда смены не будет, и это нормально.
 */
export const STORM_WIND_SHIFT_AFTER_SHOTS = 3;

/**
 * После смены магнитуда ветра бури не ниже половины шкалы — иначе «смена» была бы
 * незаметной поправкой, а по §7.8 она обязана читаться как событие.
 */
export const STORM_MIN_WIND_FRACTION = 0.5;

/**
 * Новый ветер бури, выведенный из сида (поток `::storm` — отдельный, чтобы не
 * сдвинуть последовательность боя). Детерминирован: один сид и один базовый ветер
 * → одно новое значение, поэтому смена в реплее ровно та же, что в живом бою.
 *
 * Направление всегда противоположно базовому (стрелка ветра в HUD переворачивается),
 * магнитуда — в `[MAX_WIND/2, MAX_WIND]`: смена ветра — заметное тактическое событие,
 * а не мелкая поправка, которую игрок принял бы за баг.
 */
export const stormShiftedWind = (seed: number | string, baseWind: number): number => {
    const fresh = generateWind(createSeededRandom(`${seed}::storm`));
    const magnitude =
        MAX_WIND * STORM_MIN_WIND_FRACTION + Math.abs(fresh) * (1 - STORM_MIN_WIND_FRACTION);
    const baseDir = baseWind < 0 ? -1 : 1;
    return -baseDir * magnitude;
};
