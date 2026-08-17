import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersistentFlag } from './persistent-flag';

function Probe({
    flag,
    onRender,
}: {
    flag: { useFlag: () => boolean };
    onRender: (v: boolean) => void;
}) {
    onRender(flag.useFlag());
    return null;
}

describe('createPersistentFlag', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('по умолчанию флаг опущен — пользователь ещё не видел подсказку', () => {
        const flag = createPersistentFlag('pt-test-flag');
        let seen: boolean | undefined;
        render(<Probe flag={flag} onRender={(v) => (seen = v)} />);

        expect(seen).toBe(false);
    });

    it('mark пишет флаг в localStorage и будит подписчиков', () => {
        const flag = createPersistentFlag('pt-test-flag');
        let seen: boolean | undefined;
        render(<Probe flag={flag} onRender={(v) => (seen = v)} />);

        act(() => flag.mark());

        expect(localStorage.getItem('pt-test-flag')).toBe('1');
        expect(seen).toBe(true);
    });

    it('уже поднятый флаг сразу виден новому читателю — переживает переход между экранами', () => {
        localStorage.setItem('pt-test-flag', '1');
        const flag = createPersistentFlag('pt-test-flag');
        let seen: boolean | undefined;
        render(<Probe flag={flag} onRender={(v) => (seen = v)} />);

        expect(seen).toBe(true);
    });

    it('mark идемпотентен — повторный вызов держит флаг, а не роняет', () => {
        const flag = createPersistentFlag('pt-test-flag');
        act(() => flag.mark());
        act(() => flag.mark());

        expect(localStorage.getItem('pt-test-flag')).toBe('1');
    });

    it('разные ключи не мешают друг другу', () => {
        const aim = createPersistentFlag('pt-flag-a');
        const sound = createPersistentFlag('pt-flag-b');
        let aimSeen: boolean | undefined;
        let soundSeen: boolean | undefined;
        render(
            <>
                <Probe flag={aim} onRender={(v) => (aimSeen = v)} />
                <Probe flag={sound} onRender={(v) => (soundSeen = v)} />
            </>,
        );

        act(() => aim.mark());

        expect(aimSeen).toBe(true);
        expect(soundSeen).toBe(false);
    });

    it('поднятие флага в другой вкладке гасит подсказку и здесь (событие storage)', () => {
        const flag = createPersistentFlag('pt-test-flag');
        let seen: boolean | undefined;
        render(<Probe flag={flag} onRender={(v) => (seen = v)} />);

        localStorage.setItem('pt-test-flag', '1');
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'pt-test-flag' }));
        });

        expect(seen).toBe(true);
    });

    it('чужой ключ в событии storage перечитывание не вызывает', () => {
        const flag = createPersistentFlag('pt-test-flag');
        let renders = 0;
        render(<Probe flag={flag} onRender={() => (renders += 1)} />);
        const before = renders;

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'pt-other-flag' }));
        });

        expect(renders).toBe(before);
    });

    it('заблокированный storage не роняет чтение — флаг считается опущенным', () => {
        // Приватный режим Safari: обращение к localStorage бросает SecurityError.
        localStorage.setItem('pt-test-flag', '1');
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        const flag = createPersistentFlag('pt-test-flag');
        let seen: boolean | undefined;
        render(<Probe flag={flag} onRender={(v) => (seen = v)} />);

        expect(seen).toBe(false);
    });

    it('отказ записи (QuotaExceeded) не роняет mark — подписчиков всё равно будим', () => {
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        const flag = createPersistentFlag('pt-test-flag');
        let seen: boolean | undefined;
        render(<Probe flag={flag} onRender={(v) => (seen = v)} />);

        expect(() => act(() => flag.mark())).not.toThrow();
        // Записать не удалось — флаг остаётся опущенным (подсказку покажем ещё раз),
        // но экран из-за этого не падает: storage не критичен для рендера.
        expect(seen).toBe(false);
    });

    it('ключ доступен снаружи — тесты и миграции не дублируют строку', () => {
        expect(createPersistentFlag('pt-test-flag').key).toBe('pt-test-flag');
    });
});
