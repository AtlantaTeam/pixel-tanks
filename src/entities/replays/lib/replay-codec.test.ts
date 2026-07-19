import { describe, expect, it } from 'vitest';
import type { TReplay, TReplayMove } from '../t-replay';
import { decodeReplay, encodeReplay } from './replay-codec';

/** Формат URL-safe base64 без padding: только буквы, цифры, `-` и `_`. */
const URL_SAFE_PATTERN = /^[A-Za-z0-9_-]+$/;

const fire = (angle: number, power: number): TReplayMove => ({ kind: 'fire', angle, power });
const move = (delta: number): TReplayMove => ({ kind: 'move', delta });

/** Собирает запись боя с размером поля по умолчанию — размер тут не в фокусе. */
const battle = (seed: number | string, moves: TReplayMove[]): TReplay => ({
    seed,
    width: 800,
    height: 600,
    moves,
});

describe('encodeReplay / decodeReplay', () => {
    it('восстанавливает строковый seed и все ходы (round-trip)', () => {
        const replay = battle('daily-2026-07-19', [
            move(-150),
            fire(-Math.PI / 3, 12),
            move(150),
            fire(2.123456789012345, 1),
        ]);

        const decoded = decodeReplay(encodeReplay(replay));

        expect(decoded).toEqual(replay);
    });

    it('сохраняет числовой seed числом — иначе PRNG даст другую последовательность', () => {
        const replay = battle(1752873600123, [fire(1.5, 10)]);

        const decoded = decodeReplay(encodeReplay(replay));

        expect(decoded?.seed).toBe(1752873600123);
        expect(typeof decoded?.seed).toBe('number');
    });

    it('восстанавливает логический размер поля', () => {
        const decoded = decodeReplay(
            encodeReplay({ seed: 's', width: 1440, height: 810, moves: [fire(1.2, 9)] }),
        );

        expect(decoded?.width).toBe(1440);
        expect(decoded?.height).toBe(810);
    });

    it('угол выстрела восстанавливается бит-в-бит (float64, без квантования)', () => {
        const angle = -2.7182818284590455;
        const decoded = decodeReplay(encodeReplay(battle('s', [fire(angle, 20)])));

        expect(decoded?.moves[0]).toEqual(fire(angle, 20));
    });

    it('кодирует бой без ходов', () => {
        const decoded = decodeReplay(encodeReplay(battle('empty', [])));

        expect(decoded).toEqual(battle('empty', []));
    });

    it('кодирует бой любой длины (500 ходов)', () => {
        const moves: TReplayMove[] = [];
        for (let i = 0; i < 500; i++) {
            moves.push(i % 2 === 0 ? fire(-Math.PI + i * 0.01, (i % 20) + 1) : move(i - 250));
        }

        const decoded = decodeReplay(encodeReplay(battle('long-battle', moves)));

        expect(decoded).toEqual(battle('long-battle', moves));
    });

    it('поддерживает seed с не-ASCII символами (UTF-8)', () => {
        const replay = battle('бой-дня-☀', [fire(0.5, 5)]);

        expect(decodeReplay(encodeReplay(replay))).toEqual(replay);
    });

    it('выдаёт URL-safe строку без padding', () => {
        const code = encodeReplay(
            battle('url-safety', [fire(-1.234, 18), move(-150), fire(0.001, 3)]),
        );

        expect(code).toMatch(URL_SAFE_PATTERN);
        expect(code).not.toContain('=');
    });

    it('возвращает null для пустой строки', () => {
        expect(decodeReplay('')).toBeNull();
    });

    it('возвращает null для строки с недопустимыми символами', () => {
        expect(decodeReplay('это не base64url!')).toBeNull();
    });

    it('возвращает null для обрезанного кода', () => {
        const code = encodeReplay(battle('cut', [fire(1.1, 10)]));

        expect(decodeReplay(code.slice(0, code.length - 4))).toBeNull();
    });

    it('возвращает null для неизвестной версии формата', () => {
        // 4 символа base64url «_wAA» = байты [255, 0, 0]: длины хватает, чтобы дойти
        // до сравнения версии (первый байт 255 ≠ текущей), — там и отсекается.
        expect(decodeReplay('_wAA')).toBeNull();
    });

    it('возвращает null для мусора, похожего на base64url', () => {
        expect(decodeReplay('AAAA')).toBeNull();
        expect(decodeReplay('abc')).toBeNull();
    });

    it('возвращает null для NaN/Infinity-угла из crafted-кода', () => {
        // Собираем валидный по структуре код руками: версия 2, числовой seed,
        // поле 800×600, один выстрел с angle = NaN (все биты float64 = 0xFF).
        const bytes = new Uint8Array([2, 0, ...new Array(8).fill(0)]);
        const view = new DataView(bytes.buffer);
        view.setFloat64(2, 42); // seed
        const tail = new Uint8Array(4 + 10);
        const tailView = new DataView(tail.buffer);
        tailView.setUint16(0, 800);
        tailView.setUint16(2, 600);
        tail[4] = 1; // тег fire
        tailView.setFloat64(5, NaN);
        tail[13] = 10; // power
        const full = new Uint8Array(bytes.length + tail.length);
        full.set(bytes);
        full.set(tail, bytes.length);
        // Кодируем в base64url тем же алфавитом, что и кодек.
        const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        let code = '';
        for (let i = 0; i < full.length; i += 3) {
            const b0 = full[i];
            const b1 = full[i + 1] ?? 0;
            const b2 = full[i + 2] ?? 0;
            code += B64[b0 >> 2];
            code += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
            if (i + 1 < full.length) code += B64[((b1 & 0x0f) << 2) | (b2 >> 6)];
            if (i + 2 < full.length) code += B64[b2 & 0x3f];
        }

        expect(decodeReplay(code)).toBeNull();
    });

    it('бросает RangeError при delta вне int16 — это баг записи, не данные', () => {
        expect(() => encodeReplay(battle('s', [move(40000)]))).toThrow(RangeError);
    });

    it('бросает RangeError при нецелой или отрицательной power', () => {
        expect(() => encodeReplay(battle('s', [fire(1, 3.5)]))).toThrow(RangeError);
        expect(() => encodeReplay(battle('s', [fire(1, -1)]))).toThrow(RangeError);
    });

    it('бросает RangeError для seed-строки длиннее 65535 байт', () => {
        expect(() => encodeReplay(battle('x'.repeat(70000), []))).toThrow(RangeError);
    });

    it('бросает RangeError при размере поля вне u16', () => {
        expect(() => encodeReplay({ seed: 's', width: 0, height: 600, moves: [] })).toThrow(
            RangeError,
        );
        expect(() => encodeReplay({ seed: 's', width: 800, height: 70000, moves: [] })).toThrow(
            RangeError,
        );
    });
});
