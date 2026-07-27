import { fireEvent, render } from '@testing-library/react';
import { DesignSystemPage } from './design-system-page';

describe('DesignSystemPage', () => {
    it('рендерит заголовки базовых секций (01-04)', () => {
        const { getByRole } = render(<DesignSystemPage />);

        expect(getByRole('heading', { name: /Палитра/ })).toBeInTheDocument();
        expect(getByRole('heading', { name: /Типографика/ })).toBeInTheDocument();
        expect(getByRole('heading', { name: /Компоненты/ })).toBeInTheDocument();
        expect(getByRole('heading', { name: /Тема/ })).toBeInTheDocument();
    });

    it('рендерит расширенные секции инвентаря (05-14) с нумерацией 1:1', () => {
        const { getByText } = render(<DesignSystemPage />);

        expect(getByText(/05 — Решения/)).toBeInTheDocument();
        expect(getByText(/06 — Эффект-токены/)).toBeInTheDocument();
        expect(getByText(/07 — Иконки/)).toBeInTheDocument();
        expect(getByText(/08 — Новые компоненты/)).toBeInTheDocument();
        expect(getByText(/09 — Состояния/)).toBeInTheDocument();
        expect(getByText(/10 — Игровые контролы/)).toBeInTheDocument();
        expect(getByText(/11 — Экраны/)).toBeInTheDocument();
        expect(getByText(/12 — Новый экран/)).toBeInTheDocument();
        expect(getByText(/13 — Game Over/)).toBeInTheDocument();
        expect(getByText(/14 — Дисплейный шрифт/)).toBeInTheDocument();
    });

    it('глобальный переключатель темы в шапке меняет data-faction на корневой обёртке', () => {
        const { getByRole, getByTestId } = render(<DesignSystemPage />);
        const scope = getByTestId('ds-faction-scope');

        expect(scope).toHaveAttribute('data-faction', 'player');

        fireEvent.click(getByRole('radio', { name: 'Враг' }));
        expect(scope).toHaveAttribute('data-faction', 'enemy');

        fireEvent.click(getByRole('radio', { name: 'Игрок' }));
        expect(scope).toHaveAttribute('data-faction', 'player');
    });

    it('глобальный переключатель интенсивности меняет data-intensity на корневой обёртке', () => {
        const { getByRole, getByTestId } = render(<DesignSystemPage />);
        const scope = getByTestId('ds-faction-scope');

        expect(scope).not.toHaveAttribute('data-intensity');

        fireEvent.click(getByRole('radio', { name: 'Спокойный HUD' }));
        expect(scope).toHaveAttribute('data-intensity', 'calm');

        fireEvent.click(getByRole('radio', { name: 'Неон' }));
        expect(scope).not.toHaveAttribute('data-intensity');
    });

    it('нет ни одного эмодзи-глифа на витрине — только <Icon>', () => {
        const { container } = render(<DesignSystemPage />);

        expect(container.textContent).not.toMatch(
            /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}]/u,
        );
        expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    });

    it('Dialog (§03) показан статичным срезом без клика', () => {
        // Статичный срез не модальный → не заявляет role="dialog"; проверяем по
        // заголовку среза, что он отрисован в потоке без интеракции.
        const { getAllByRole } = render(<DesignSystemPage />);

        const victory = getAllByRole('heading', { name: 'Победа' });
        expect(victory.length).toBeGreaterThan(0);
    });

    it('Пауза (§12) показана статичным срезом без клика, PauseOverlay реален', () => {
        const { getByRole } = render(<DesignSystemPage />);

        expect(getByRole('heading', { name: 'Пауза' })).toBeInTheDocument();
    });

    it('роль-подписи цветов (§01) показывают ink-пару текстом на заливке, без отдельных -ink свотчей', () => {
        const { getAllByText, queryByText } = render(<DesignSystemPage />);

        expect(getAllByText('действие · золото').length).toBeGreaterThan(0);
        expect(getAllByText('враг · маджента').length).toBeGreaterThan(0);
        expect(queryByText('primary-ink')).not.toBeInTheDocument();
        expect(queryByText('accent-ink')).not.toBeInTheDocument();
    });
});
