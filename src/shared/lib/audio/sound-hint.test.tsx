import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markSoundHintSeen, useSoundHintSeen } from './sound-hint';

const SOUND_HINT_STORAGE_KEY = 'pt-sound-hint-seen';

function Probe({ onRender }: { onRender: (seen: boolean) => void }) {
    onRender(useSoundHintSeen());
    return null;
}

describe('sound-hint (разовая подсказка звука #584)', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('по умолчанию подсказку ещё не видели', () => {
        let seen: boolean | undefined;
        render(<Probe onRender={(value) => (seen = value)} />);

        expect(seen).toBe(false);
    });

    it('markSoundHintSeen пишет флаг и переживает перечитывание (переживает перезагрузку)', () => {
        let seen: boolean | undefined;
        render(<Probe onRender={(value) => (seen = value)} />);

        expect(seen).toBe(false);

        act(() => markSoundHintSeen());

        expect(localStorage.getItem(SOUND_HINT_STORAGE_KEY)).toBe('1');
        expect(seen).toBe(true);
    });

    it('уже сохранённый флаг сразу отдаёт «видел» новому читателю (переход между экранами)', () => {
        localStorage.setItem(SOUND_HINT_STORAGE_KEY, '1');
        let seen: boolean | undefined;
        render(<Probe onRender={(value) => (seen = value)} />);

        expect(seen).toBe(true);
    });

    it('markSoundHintSeen идемпотентен — повторный вызов не роняет и держит флаг', () => {
        act(() => markSoundHintSeen());
        act(() => markSoundHintSeen());

        expect(localStorage.getItem(SOUND_HINT_STORAGE_KEY)).toBe('1');
    });
});
