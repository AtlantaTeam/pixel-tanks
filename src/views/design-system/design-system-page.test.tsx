import { fireEvent, render } from '@testing-library/react';
import { DesignSystemPage } from './design-system-page';

describe('DesignSystemPage', () => {
    it('рендерит ключевые секции витрины', () => {
        const { getByRole } = render(<DesignSystemPage />);

        expect(getByRole('heading', { name: /Палитра/ })).toBeInTheDocument();
        expect(getByRole('heading', { name: /Типографика/ })).toBeInTheDocument();
        expect(getByRole('heading', { name: /Компоненты/ })).toBeInTheDocument();
        expect(getByRole('heading', { name: /Эффекты/ })).toBeInTheDocument();
        expect(getByRole('heading', { name: /Тема/ })).toBeInTheDocument();
    });

    it('переключатель темы меняет data-faction на контейнере-обёртке', () => {
        const { getByRole, getByTestId } = render(<DesignSystemPage />);
        const scope = getByTestId('ds-faction-scope');

        expect(scope).toHaveAttribute('data-faction', 'player');

        fireEvent.click(getByRole('button', { name: 'Враг' }));
        expect(scope).toHaveAttribute('data-faction', 'enemy');

        fireEvent.click(getByRole('button', { name: 'Игрок' }));
        expect(scope).toHaveAttribute('data-faction', 'player');
    });

    it('Dialog открывается и закрывается по кнопке', () => {
        const { getByRole, queryByRole } = render(<DesignSystemPage />);

        expect(queryByRole('dialog')).not.toBeInTheDocument();

        fireEvent.click(getByRole('button', { name: 'Открыть диалог' }));
        expect(getByRole('dialog')).toBeInTheDocument();

        fireEvent.click(getByRole('button', { name: 'Закрыть' }));
        expect(queryByRole('dialog')).not.toBeInTheDocument();
    });
});
