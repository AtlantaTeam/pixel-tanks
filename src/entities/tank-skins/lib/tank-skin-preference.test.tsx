import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TANK_SKIN_ID } from '../tank-skins.data';
import { getStoredTankSkinId, useTankSkinPreference } from './tank-skin-preference';

const SKIN_STORAGE_KEY = 'tank-skin';

function Probe({
    onRender,
}: {
    onRender: (api: ReturnType<typeof useTankSkinPreference>) => void;
}) {
    onRender(useTankSkinPreference());
    return null;
}

describe('getStoredTankSkinId', () => {
    beforeEach(() => localStorage.clear());

    it('без сохранённого значения возвращает дефолт', () => {
        expect(getStoredTankSkinId()).toBe(DEFAULT_TANK_SKIN_ID);
    });

    it('возвращает сохранённый валидный скин', () => {
        localStorage.setItem(SKIN_STORAGE_KEY, 'heavy-crimson');
        expect(getStoredTankSkinId()).toBe('heavy-crimson');
    });

    it('битое/устаревшее значение — тихий фолбэк на дефолт, не падение', () => {
        localStorage.setItem(SKIN_STORAGE_KEY, 'not-a-real-skin');
        expect(getStoredTankSkinId()).toBe(DEFAULT_TANK_SKIN_ID);
    });
});

describe('useTankSkinPreference', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('setSkinId пишет в localStorage и переживает перечитывание (issue #481: «переживает перезагрузку»)', () => {
        let api: ReturnType<typeof useTankSkinPreference> | undefined;
        render(<Probe onRender={(value) => (api = value)} />);

        expect(api?.skinId).toBe(DEFAULT_TANK_SKIN_ID);

        act(() => api?.setSkinId('heavy-amber'));

        expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe('heavy-amber');
        expect(api?.skinId).toBe('heavy-amber');
        // «Перезагрузка страницы» — новый читатель того же ключа видит то же значение.
        expect(getStoredTankSkinId()).toBe('heavy-amber');
    });
});
