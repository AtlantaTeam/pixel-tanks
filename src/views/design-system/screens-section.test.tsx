import { render, within } from '@testing-library/react';
import { ScreensSection } from './screens-section';

const SCREEN_TITLES = [
    'Логин / Регистрация',
    'Профиль',
    'Бой дня',
    'Реплей / Поделиться',
    'Онбординг «Как играть»',
    'Игровой экран (mobile-first)',
    'Utility · загрузка / 404 / ошибка',
];

const SCREEN_NOTES = [
    'email+пароль, без Google, выбор фракции · 1 кол → 2 кол (арт+форма) на планшете+',
    'аватар-фракция, статистика, история боёв + реплеи · стек → сайдбар+сетка',
    'вызов + результат/сравнение + лидерборд дня, табы День/Всё время',
    'плеер + карточка шеринга',
    '3 шага, пиктограммы, пагинация',
    'Canvas + HUD + тач-рогатка; десктоп — HUD-бар сверху',
    'переиспользуемые заглушки',
];

const FRAME_LABELS = ['Mobile · 390', 'Планшет · 768', 'Desktop · 1280', 'Wide · 1920'];

/** Четыре кадра каждого экрана рендерятся одновременно, без переключателя —
 *  это статичные срезы, а не интерактивный ресайз. */
const FRAMES_PER_SCREEN = 4;

describe('ScreensSection', () => {
    it('рендерит все семь заголовков каталога экранов', () => {
        const { getByRole } = render(<ScreensSection />);

        for (const title of SCREEN_TITLES) {
            expect(getByRole('heading', { name: title })).toBeInTheDocument();
        }
    });

    it('подписывает каждый экран note дословно из инвентаря', () => {
        const { getByText } = render(<ScreensSection />);

        for (const note of SCREEN_NOTES) {
            expect(getByText(note)).toBeInTheDocument();
        }
    });

    it('показывает четыре кадра брейкпоинтов у каждого из семи экранов', () => {
        const { getAllByText } = render(<ScreensSection />);

        for (const label of FRAME_LABELS) {
            expect(getAllByText(label)).toHaveLength(SCREEN_TITLES.length);
        }
    });

    it('сохраняет легенду брейкпоинтов над каталогом', () => {
        const { getByText } = render(<ScreensSection />);

        expect(getByText(/Каждый экран — резиновый layout в кадрах/)).toBeInTheDocument();
        expect(getByText(/Планшет — первоклассная цель/)).toBeInTheDocument();
    });

    it('логин показывает форму с фракцией во всех четырёх кадрах', () => {
        const { getAllByText, getAllByLabelText } = render(<ScreensSection />);

        expect(getAllByLabelText('Позывной')).toHaveLength(FRAMES_PER_SCREEN);
        expect(getAllByText('Создать бойца')).toHaveLength(FRAMES_PER_SCREEN);
        expect(getAllByText('Зелёные')).toHaveLength(FRAMES_PER_SCREEN);
    });

    it('игровой экран показывает HUD-телеметрию и HP обеих сторон во всех кадрах', () => {
        const { getByTestId } = render(<ScreensSection />);
        // Ряд кадров брейкпоинтов игрового экрана — свой testid (issue #427,
        // отдельный от ряда состояний ниже, чтобы счёт вхождений не смешивался:
        // «свой ход»/«спокойный HUD» из ряда состояний добавляют «ТВОЙ ХОД» ещё
        // дважды, а этот тест считает именно четыре кадра брейкпоинтов).
        const breakpoints = within(getByTestId('game-screen-breakpoints'));

        expect(breakpoints.getAllByText('ТВОЙ ХОД')).toHaveLength(FRAMES_PER_SCREEN);
        expect(breakpoints.getAllByText('Огонь')).toHaveLength(FRAMES_PER_SCREEN);
    });

    it('игровой экран показывает состояния боя отдельным рядом (issue #427)', () => {
        const { getByTestId } = render(<ScreensSection />);
        const states = within(getByTestId('game-screen-states'));

        expect(states.getByText('Свой ход')).toBeInTheDocument();
        expect(states.getByText('Ход бота')).toBeInTheDocument();
        expect(states.getByText('Прицеливание')).toBeInTheDocument();
        expect(states.getByText('Пустой боезапас')).toBeInTheDocument();
        expect(states.getByText('Спокойный HUD')).toBeInTheDocument();

        // Ход бота: пилюля хода и лок палубы.
        expect(states.getAllByText('ХОД СОПЕРНИКА').length).toBeGreaterThan(0);
        expect(states.getByText('Ход соперника')).toBeInTheDocument();
        // Пустой боезапас: тост-предупреждение и disabled-подпись кнопки ОГОНЬ.
        expect(states.getByText(/Патроны кончились/)).toBeInTheDocument();
        expect(states.getByText('нет снарядов')).toBeInTheDocument();
    });

    it('utility-кадр показывает загрузку, 404 и ошибку одновременно', () => {
        const { getAllByText } = render(<ScreensSection />);

        expect(getAllByText('Загрузка боя…')).toHaveLength(FRAMES_PER_SCREEN);
        expect(getAllByText('404')).toHaveLength(FRAMES_PER_SCREEN);
        expect(getAllByText('Что-то сломалось')).toHaveLength(FRAMES_PER_SCREEN);
    });

    it('десктопный вариант layout переиспользуется на кадрах 1280 и 1920', () => {
        const { getAllByText } = render(<ScreensSection />);

        // Клавиатурная подсказка есть только в desktop-варианте игрового экрана —
        // значит она видна ровно дважды: на 1280 и на 1920 (состояния боя ниже
        // рендерятся на мобильном варианте и её не показывают).
        expect(getAllByText('Space выстрел')).toHaveLength(2);
    });

    it('не подменяет иконки эмодзи-глифами', () => {
        const { container } = render(<ScreensSection />);

        expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    });
});
