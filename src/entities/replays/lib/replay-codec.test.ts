import { describe, expect, it } from 'vitest';
import type { TReplay, TReplayMove } from '../t-replay';
import { decodeReplay, encodeReplay } from './replay-codec';

/** Формат URL-safe base64 без padding: только буквы, цифры, `-` и `_`. */
const URL_SAFE_PATTERN = /^[A-Za-z0-9_-]+$/;

const fire = (angle: number, power: number): TReplayMove => ({ kind: 'fire', angle, power });
const move = (delta: number): TReplayMove => ({ kind: 'move', delta });

describe('encodeReplay / decodeReplay', () => {
    it('восстанавливает строковый seed и все ходы (round-trip)', () => {
        const replay: TReplay = {
            seed: 'daily-2026-07-19',
            moves: [move(-150), fire(-Math.PI / 3, 12), move(150), fire(2.123456789012345, 1)],
        };

        const decoded = decodeReplay(encodeReplay(replay));

        expect(decoded).toEqual(replay);
    });

    it('сохраняет числовой seed числом — иначе PRNG даст другую последовательность', () => {
        const replay: TReplay = { seed: 1752873600123, moves: [fire(1.5, 10)] };

        const decoded = decodeReplay(encodeReplay(replay));

        expect(decoded?.seed).toBe(1752873600123);
        expect(typeof decoded?.seed).toBe('number');
    });

    it('угол выстрела восстанавливается бит-в-бит (float64, без квантования)', () => {
        const angle = -2.7182818284590455;
        const decoded = decodeReplay(encodeReplay({ seed: 's', moves: [fire(angle, 20)] }));

        expect(decoded?.moves[0]).toEqual(fire(angle, 20));
    });

    it('кодирует бой без ходов', () => {
        const decoded = decodeReplay(encodeReplay({ seed: 'empty', moves: [] }));

        expect(decoded).toEqual({ seed: 'empty', moves: [] });
    });

    it('кодирует бой любой длины (500 ходов)', () => {
        const moves: TReplayMove[] = [];
        for (let i = 0; i < 500; i++) {
            moves.push(i % 2 === 0 ? fire(-Math.PI + i * 0.01, (i % 20) + 1) : move(i - 250));
        }

        const decoded = decodeReplay(encodeReplay({ seed: 'long-battle', moves }));

        expect(decoded).toEqual({ seed: 'long-battle', moves });
    });

    it('поддерживает seed с не-ASCII символами (UTF-8)', () => {
        const replay: TReplay = { seed: 'бой-дня-☀', moves: [fire(0.5, 5)] };

        expect(decodeReplay(encodeReplay(replay))).toEqual(replay);
    });

    it('выдаёт URL-safe строку без padding', () => {
        const code = encodeReplay({
            seed: 'url-safety',
            moves: [fire(-1.234, 18), move(-150), fire(0.001, 3)],
        });

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
        const code = encodeReplay({ seed: 'cut', moves: [fire(1.1, 10)] });

        expect(decodeReplay(code.slice(0, code.length - 4))).toBeNull();
    });

    it('возвращает null для неизвестной версии формата', () => {
        // Валидный base64url, но первый байт (версия) = 255.
        expect(decodeReplay('_w')).toBeNull();
    });

    it('возвращает null для мусора, похожего на base64url', () => {
        expect(decodeReplay('AAAA')).toBeNull();
        expect(decodeReplay('abc')).toBeNull();
    });

    it('бросает RangeError при delta вне int16 — это баг записи, не данные', () => {
        expect(() => encodeReplay({ seed: 's', moves: [move(40000)] })).toThrow(RangeError);
    });

    it('бросает RangeError при нецелой или отрицательной power', () => {
        expect(() => encodeReplay({ seed: 's', moves: [fire(1, 3.5)] })).toThrow(RangeError);
        expect(() => encodeReplay({ seed: 's', moves: [fire(1, -1)] })).toThrow(RangeError);
    });

    it('бросает RangeError для seed-строки длиннее 65535 байт', () => {
        expect(() => encodeReplay({ seed: 'x'.repeat(70000), moves: [] })).toThrow(RangeError);
    });
});
