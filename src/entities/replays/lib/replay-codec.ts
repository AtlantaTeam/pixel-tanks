import { POWER_MAX, POWER_MIN } from '@/shared/config';
import type { TReplay, TReplayMove } from '../t-replay';

/**
 * Бинарный формат записи боя, затем base64url без padding:
 *
 * ```
 * [версия u8] [тип seed u8]
 *   seed-число:  float64
 *   seed-строка: [длина u16] [байты UTF-8]
 * [width u16] [height u16]              — логический размер поля боя
 * [insetTop u16] [insetBottom u16]      — ТОЛЬКО версия 3: инсеты safe-зоны
 * далее ходы до конца буфера:
 *   move: [тег u8 = 0] [delta int16]
 *   fire: [тег u8 = 1] [angle float64] [power u8]
 * ```
 *
 * Угол — float64 без потерь: физика чувствительна к младшим битам, любое
 * квантование даёт другую траекторию и ломает идентичность реплея. Размер поля
 * (v2) хранится в формате, потому что вся физика в абсолютных пикселях — без него
 * ссылка с десктопа, открытая на телефоне, дала бы другой рельеф и другой счёт.
 *
 * **Версия 3** добавляет инсеты safe-зоны (issue #454): рельеф генерится ВНУТРИ
 * свободной зоны между оверлеями, поэтому без инсетов воспроизведение получило бы
 * другой рельеф. Инсеты пишутся как u16 (пиксели, `Ground` всё равно целочислен —
 * см. `computeTerrainHeights`, там же округление). Версия 2 читается по-прежнему —
 * её записи не имеют инсетов (рельеф во весь канвас, как и был записан). Записи без
 * инсетов (или с нулевыми) кодируются версией 2 — компактность и совместимость
 * старых ссылок.
 */
const REPLAY_FORMAT_VERSION_V2 = 2;
const REPLAY_FORMAT_VERSION_V3 = 3;

const SEED_TYPE_NUMBER = 0;
const SEED_TYPE_STRING = 1;

const MOVE_TAG_MOVE = 0;
const MOVE_TAG_FIRE = 1;

/** Байты на ход: тег + int16 delta. */
const MOVE_RECORD_SIZE = 3;
/** Байты на выстрел: тег + float64 angle + u8 power. */
const FIRE_RECORD_SIZE = 10;
/** Байты на размер поля: width u16 + height u16. */
const FIELD_SIZE = 4;
/** Байты на инсеты safe-зоны (только v3): top u16 + bottom u16. */
const INSETS_SIZE = 4;

const INT16_MIN = -32768;
const INT16_MAX = 32767;
const UINT8_MAX = 255;
const UINT16_MAX = 65535;

/**
 * Семантические границы игры — уже структурных лимитов формата. Код приходит из
 * недоверенного URL, поэтому декодер проверяет не только «влезает в байты», но и
 * «правдоподобно как ход реального боя»: иначе crafted-код с `angle = NaN`,
 * `power = 255` или бесконечным перемещением проходил бы как «валидный» реплей.
 */
// Диапазон силы выстрела — единый источник в `shared/config` (POWER_MIN/POWER_MAX),
// общий с Tank.powerMin/powerMax и клампом ввода в game-engine.
/** Предел |delta| перемещения: игра двигает танк на ±150, берём щедрый запас. */
const MAX_MOVE_DELTA = 4096;
/** Верхняя граница числа ходов — защита от кода, раздувающего воспроизведение. */
const MAX_MOVES = 1000;
/** Разумные границы логического размера поля в CSS-пикселях. */
const MIN_FIELD_DIMENSION = 1;
const MAX_FIELD_DIMENSION = UINT16_MAX;

/** Алфавит base64url (RFC 4648 §5) — только символы, безопасные в URL. */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64_VALUES = new Map([...B64_CHARS].map((char, index) => [char, index]));

const toBase64Url = (bytes: Uint8Array): string => {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = bytes[i + 1] ?? 0;
        const b2 = bytes[i + 2] ?? 0;
        out += B64_CHARS[b0 >> 2];
        out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
        if (i + 1 < bytes.length) out += B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)];
        if (i + 2 < bytes.length) out += B64_CHARS[b2 & 0x3f];
    }
    return out;
};

const fromBase64Url = (code: string): Uint8Array | null => {
    // Длина % 4 === 1 невозможна для base64 без padding: один символ — 6 бит,
    // а на байт нужно минимум 8.
    if (code.length === 0 || code.length % 4 === 1) return null;
    const bytes = new Uint8Array(Math.floor((code.length * 3) / 4));
    let acc = 0;
    let bits = 0;
    let index = 0;
    for (const char of code) {
        const value = B64_VALUES.get(char);
        if (value === undefined) return null;
        acc = (acc << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes[index++] = (acc >> bits) & 0xff;
        }
    }
    return bytes;
};

const assertInRange = (value: number, min: number, max: number, label: string) => {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(
            `Реплей: ${label} должен быть целым в [${min}, ${max}], получено ${value}`,
        );
    }
};

/**
 * Кодирует запись боя в компактную URL-safe строку.
 * Бросает `RangeError`, если ход не влезает в формат (delta вне int16,
 * power вне u8, seed-строка длиннее 65535 байт, размер поля вне u16) — такие
 * значения в игре не возникают, их появление означает баг записи, а не данные
 * для усечения.
 */
export const encodeReplay = (replay: TReplay): string => {
    const seedBytes =
        typeof replay.seed === 'string' ? new TextEncoder().encode(replay.seed) : null;
    if (seedBytes && seedBytes.length > UINT16_MAX) {
        throw new RangeError(`Реплей: seed длиннее ${UINT16_MAX} байт не поддерживается`);
    }
    assertInRange(replay.width, MIN_FIELD_DIMENSION, MAX_FIELD_DIMENSION, 'ширина поля');
    assertInRange(replay.height, MIN_FIELD_DIMENSION, MAX_FIELD_DIMENSION, 'высота поля');

    // Инсеты хранятся целыми (u16): рельеф всё равно целочислен. Нулевые/отсутствующие
    // инсеты → версия 2 (компактнее и совместимо со старыми ссылками), иначе v3.
    const insetTop = replay.insets ? Math.round(replay.insets.top) : 0;
    const insetBottom = replay.insets ? Math.round(replay.insets.bottom) : 0;
    const hasInsets = insetTop !== 0 || insetBottom !== 0;
    if (hasInsets) {
        assertInRange(insetTop, 0, UINT16_MAX, 'верхний инсет');
        assertInRange(insetBottom, 0, UINT16_MAX, 'нижний инсет');
    }
    const version = hasInsets ? REPLAY_FORMAT_VERSION_V3 : REPLAY_FORMAT_VERSION_V2;

    let size =
        2 + (seedBytes ? 2 + seedBytes.length : 8) + FIELD_SIZE + (hasInsets ? INSETS_SIZE : 0);
    for (const move of replay.moves) {
        size += move.kind === 'move' ? MOVE_RECORD_SIZE : FIRE_RECORD_SIZE;
    }

    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    bytes[offset++] = version;
    if (seedBytes) {
        bytes[offset++] = SEED_TYPE_STRING;
        view.setUint16(offset, seedBytes.length);
        offset += 2;
        bytes.set(seedBytes, offset);
        offset += seedBytes.length;
    } else {
        bytes[offset++] = SEED_TYPE_NUMBER;
        view.setFloat64(offset, replay.seed as number);
        offset += 8;
    }

    view.setUint16(offset, replay.width);
    offset += 2;
    view.setUint16(offset, replay.height);
    offset += 2;

    if (hasInsets) {
        view.setUint16(offset, insetTop);
        offset += 2;
        view.setUint16(offset, insetBottom);
        offset += 2;
    }

    for (const move of replay.moves) {
        if (move.kind === 'move') {
            assertInRange(move.delta, INT16_MIN, INT16_MAX, 'delta перемещения');
            bytes[offset++] = MOVE_TAG_MOVE;
            view.setInt16(offset, move.delta);
            offset += 2;
        } else {
            assertInRange(move.power, 0, UINT8_MAX, 'power выстрела');
            bytes[offset++] = MOVE_TAG_FIRE;
            view.setFloat64(offset, move.angle);
            offset += 8;
            bytes[offset++] = move.power;
        }
    }
    return toBase64Url(bytes);
};

/**
 * Декодирует строку реплея. Любой невалидный вход (мусор, обрезанный код,
 * чужая версия формата) → `null`: код приходит из URL и ему нельзя доверять.
 */
export const decodeReplay = (code: string): TReplay | null => {
    const bytes = fromBase64Url(code);
    if (!bytes || bytes.length < 2) return null;
    const version = bytes[0];
    if (version !== REPLAY_FORMAT_VERSION_V2 && version !== REPLAY_FORMAT_VERSION_V3) return null;
    const view = new DataView(bytes.buffer);
    let offset = 1;

    let seed: number | string;
    const seedType = bytes[offset++];
    if (seedType === SEED_TYPE_NUMBER) {
        if (offset + 8 > bytes.length) return null;
        seed = view.getFloat64(offset);
        offset += 8;
    } else if (seedType === SEED_TYPE_STRING) {
        if (offset + 2 > bytes.length) return null;
        const length = view.getUint16(offset);
        offset += 2;
        if (offset + length > bytes.length) return null;
        seed = new TextDecoder().decode(bytes.subarray(offset, offset + length));
        offset += length;
    } else {
        return null;
    }

    if (offset + FIELD_SIZE > bytes.length) return null;
    const width = view.getUint16(offset);
    offset += 2;
    const height = view.getUint16(offset);
    offset += 2;
    if (width < MIN_FIELD_DIMENSION || height < MIN_FIELD_DIMENSION) return null;

    // Инсеты safe-зоны — только в v3. Значения u16 (0..65535) структурно валидны
    // всегда; зону из них зажимает движок (`computeArenaZone`), поэтому «инсет
    // больше поля» не роняет декодер, а даёт вырожденную зону при воспроизведении.
    let insets: TReplay['insets'];
    if (version === REPLAY_FORMAT_VERSION_V3) {
        if (offset + INSETS_SIZE > bytes.length) return null;
        const top = view.getUint16(offset);
        offset += 2;
        const bottom = view.getUint16(offset);
        offset += 2;
        insets = { top, bottom };
    }

    const moves: TReplayMove[] = [];
    while (offset < bytes.length) {
        // Слишком длинная запись — скорее раздутый crafted-код, чем реальный бой.
        if (moves.length >= MAX_MOVES) return null;
        const tag = bytes[offset++];
        if (tag === MOVE_TAG_MOVE) {
            if (offset + 2 > bytes.length) return null;
            const delta = view.getInt16(offset);
            offset += 2;
            if (Math.abs(delta) > MAX_MOVE_DELTA) return null;
            moves.push({ kind: 'move', delta });
        } else if (tag === MOVE_TAG_FIRE) {
            if (offset + 9 > bytes.length) return null;
            const angle = view.getFloat64(offset);
            const power = bytes[offset + 8];
            offset += 9;
            // float64 из URL может быть NaN/±Infinity, а power — любым u8:
            // отсекаем то, что не может быть исходом реального прицеливания.
            if (!Number.isFinite(angle) || power < POWER_MIN || power > POWER_MAX) return null;
            moves.push({ kind: 'fire', angle, power });
        } else {
            return null;
        }
    }
    return insets ? { seed, width, height, insets, moves } : { seed, width, height, moves };
};
