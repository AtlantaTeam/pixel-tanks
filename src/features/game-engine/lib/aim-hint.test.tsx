import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markAimHintSeen, useAimHintSeen } from './aim-hint';

const AIM_HINT_STORAGE_KEY = 'pt-aim-hint-seen';

function Probe({ onRender }: { onRender: (seen: boolean) => void }) {
    onRender(useAimHintSeen());
    return null;
}

describe('aim-hint (разовая подсказка прицеливания #565)', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('по умолчанию подсказку ещё не видели', () => {
        let seen: boolean | undefined;
        render(<Probe onRender={(value) => (seen = value)} />);

        expect(seen).toBe(false);
    });

    it('markAimHintSeen пишет флаг и переживает перечитывание (переживает перезагрузку)', () => {
        let seen: boolean | undefined;
        render(<Probe onRender={(value) => (seen = value)} />);

        expect(seen).toBe(false);

        act(() => markAimHintSeen());

        expect(localStorage.getItem(AIM_HINT_STORAGE_KEY)).toBe('1');
        // Реактивный флаг обновился в текущем рендере.
        expect(seen).toBe(true);
    });

    it('уже сохранённый флаг сразу отдаёт «видел» новому читателю (после перезагрузки)', () => {
        localStorage.setItem(AIM_HINT_STORAGE_KEY, '1');
        let seen: boolean | undefined;
        render(<Probe onRender={(value) => (seen = value)} />);

        expect(seen).toBe(true);
    });

    it('markAimHintSeen идемпотентен — повторный вызов не роняет и держит флаг', () => {
        act(() => markAimHintSeen());
        act(() => markAimHintSeen());

        expect(localStorage.getItem(AIM_HINT_STORAGE_KEY)).toBe('1');
    });
});
