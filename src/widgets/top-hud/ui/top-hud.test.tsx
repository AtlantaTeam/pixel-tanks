import { render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_WIND, useGameStore } from '@/features/game-engine';
import { EWeaponKind } from '@/shared/model';
import { BOT_NAME, POWER_MAX } from '@/shared/config';
import { TopHud } from './top-hud';

describe('TopHud', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('рендерит HP-карточки обеих сторон компактной строкой без переноса', () => {
        useGameStore.setState({ hp: { player: 72, enemy: 38 } });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.getByText('72/100')).toBeInTheDocument();
        expect(mobile.getByText('38/100')).toBeInTheDocument();
        expect(mobile.getByText('Rex Commander')).toBeInTheDocument();
        expect(mobile.getByText(BOT_NAME)).toBeInTheDocument();
    });

    it('вспышка HP-полосы (#549): lastHit.target=player красит только карточку игрока', () => {
        useGameStore.setState({
            hp: { player: 72, enemy: 38 },
            lastHit: { target: 'player', nonce: 1 },
        });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile-hp-row'));
        const bars = mobile.getAllByRole('progressbar');
        // Первая карточка ряда — игрок, вторая — бот (см. разметку HpCard ниже).
        expect(bars[0]).toHaveClass('animate-hp-hit-shake');
        expect(bars[1]).not.toHaveClass('animate-hp-hit-shake');
    });

    it('вспышка HP-полосы (#549): без lastHit обе карточки спокойны', () => {
        useGameStore.setState({ hp: { player: 72, enemy: 38 } });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile-hp-row'));
        for (const bar of mobile.getAllByRole('progressbar')) {
            expect(bar).not.toHaveClass('animate-hp-hit-shake');
        }
    });

    it('пилюля хода показывает «ТВОЙ ХОД», когда ходит игрок', () => {
        useGameStore.setState({ turn: 'player', phase: 'aiming' });
        const { getByTestId } = render(<TopHud />);

        expect(within(getByTestId('top-hud-mobile')).getByText('ТВОЙ ХОД')).toBeInTheDocument();
    });

    it('пилюля хода показывает «ХОД СОПЕРНИКА», когда ходит бот', () => {
        useGameStore.setState({ turn: 'enemy', phase: 'aiming' });
        const { getByTestId } = render(<TopHud />);

        // Селектор исключает невидимый размерник (#449) — тот тоже содержит
        // текст «ХОД СОПЕРНИКА» (резервирует ширину пилюли под самую длинную
        // подпись), но у него `aria-hidden`, а у реальной подписи — нет.
        expect(
            within(getByTestId('top-hud-mobile')).getByText('ХОД СОПЕРНИКА', {
                selector: 'span:not([aria-hidden])',
            }),
        ).toBeInTheDocument();
    });

    it('пилюля хода показывает «ВЫСТРЕЛ» во время полёта снаряда независимо от того, чей был ход', () => {
        useGameStore.setState({ turn: 'player', phase: 'flight' });
        const { getByTestId, rerender } = render(<TopHud />);
        expect(within(getByTestId('top-hud-mobile')).getByText('ВЫСТРЕЛ')).toBeInTheDocument();

        useGameStore.setState({ turn: 'enemy', phase: 'flight' });
        rerender(<TopHud />);
        expect(within(getByTestId('top-hud-mobile')).getByText('ВЫСТРЕЛ')).toBeInTheDocument();
    });

    it('на финале прячет пилюлю хода видимостью, а не размонтированием — ряд держит высоту (#447)', () => {
        useGameStore.setState({ turn: 'enemy', phase: 'over' });
        const { getByTestId } = render(<TopHud />);

        // Пилюля остаётся в DOM (держит высоту ряда), но скрыта: `invisible`
        // (visibility:hidden) + `aria-hidden` — для глаза и скринридера её нет.
        const pill = within(getByTestId('top-hud-mobile')).getByText('ХОД СОПЕРНИКА', {
            selector: 'span:not([aria-hidden])',
        });
        expect(pill).toBeInTheDocument();
        const pillBox = pill.closest('[aria-hidden="true"]');
        expect(pillBox).not.toBeNull();
        expect(pillBox).toHaveClass('invisible');
    });

    it('пилюля хода видима и без aria-hidden, пока бой идёт', () => {
        useGameStore.setState({ turn: 'enemy', phase: 'aiming' });
        const { getByTestId } = render(<TopHud />);

        const pill = within(getByTestId('top-hud-mobile')).getByText('ХОД СОПЕРНИКА', {
            selector: 'span:not([aria-hidden])',
        });
        expect(pill.closest('[aria-hidden="true"]')).toBeNull();
    });

    it('телеметрия приглушается и угол помечается «заморожен» на ходе бота', () => {
        useGameStore.setState({ turn: 'enemy' });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.getByText('Угол · заморожен')).toBeInTheDocument();
        expect(
            mobile.getByText('Твои числа заморожены до конца хода соперника'),
        ).toBeInTheDocument();
    });

    it('не помечает угол замороженным и не гасит телеметрию на ходе игрока', () => {
        useGameStore.setState({ turn: 'player' });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.getByText('Угол')).toBeInTheDocument();
        expect(
            mobile.queryByText('Твои числа заморожены до конца хода соперника'),
        ).not.toBeInTheDocument();
    });

    it('бейдж «Заморожено» скрыт во время полёта снаряда (даже если это полёт снаряда бота)', () => {
        // На полёте плашка "ВЫСТРЕЛ" уже сообщает о состоянии, дополнительный
        // бейдж "Заморожено" — лишнее (#539).
        useGameStore.setState({ turn: 'enemy', phase: 'flight' });
        const { getByTestId } = render(<TopHud />);

        // Пилюля "ВЫСТРЕЛ" видима
        expect(within(getByTestId('top-hud-desktop')).getByText('ВЫСТРЕЛ')).toBeInTheDocument();
        // Бейдж "Заморожено" скрыт видимостью (invisible), остаётся в DOM для
        // резервирования места в макете (#447 — тот же приём)
        const badge = getByTestId('freeze-badge');
        expect(badge).toHaveClass('invisible');
    });

    it('до первого выстрела ветер показывает только грубые пипы, без точного числа', () => {
        useGameStore.setState({ wind: MAX_WIND, windRevealed: false });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.queryByText('3')).not.toBeInTheDocument();
        expect(mobile.getByRole('img', { name: /грубая сила ветра/ })).toBeInTheDocument();
    });

    it('после раскрытия ветер показывает точное число', () => {
        useGameStore.setState({ wind: MAX_WIND, windRevealed: true });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.getByText('3')).toBeInTheDocument();
        expect(mobile.queryByRole('img', { name: /грубая сила ветра/ })).not.toBeInTheDocument();
    });

    it('пипы снарядов и ходов красятся фиксированными токенами, не темой хода соперника', () => {
        useGameStore.setState({
            turn: 'enemy',
            weapons: [{ id: 0, name: 'Фугас', kind: EWeaponKind.HighExplosive }],
        });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        const ammoPip = mobile
            .getAllByLabelText(/снарядов/)[0]
            .querySelector('[data-testid="pip"]');
        expect((ammoPip as HTMLElement).style.background).toBe('var(--color-accent)');
    });

    it('значение угла красится фиксированным accent-токеном (Tailwind text-accent) независимо от хода', () => {
        useGameStore.setState({ turn: 'enemy' });
        const { getByTestId } = render(<TopHud />);

        const mobile = getByTestId('top-hud-mobile');
        const angleValue = mobile.querySelector('.text-accent');
        expect(angleValue).toBeInTheDocument();
    });

    it('дизейблит кнопки ± угла/силы, пока в полёте свой снаряд (turn=player, phase=flight)', () => {
        useGameStore.setState({ turn: 'player', phase: 'flight' });
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        expect(mobile.getByRole('button', { name: 'Угол больше' })).toBeDisabled();
        expect(mobile.getByRole('button', { name: 'Сила больше' })).toBeDisabled();
    });

    it('меняет угол по кнопкам ± на мобилке', () => {
        useGameStore.setState({ angle: 0, turn: 'player' });
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        mobile.getByRole('button', { name: 'Угол больше' }).click();

        expect(useGameStore.getState().angle).toBeCloseTo(-Math.PI / 180);
    });

    it('дизейблит кнопки ± угла/силы на ходе бота', () => {
        useGameStore.setState({ turn: 'enemy' });
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        expect(mobile.getByRole('button', { name: 'Угол больше' })).toBeDisabled();
        expect(mobile.getByRole('button', { name: 'Сила больше' })).toBeDisabled();
    });

    // #450 — компактный мобильный HUD (бюджет ≤180px при hit-area ≥44).

    it('HP-карточки мобилки — inline-раскладка: трек тянется в общей строке (#450)', () => {
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        // inline-раскладка HPBar кладёт трек в один ряд с именем/числом и тянет его
        // `flex-1` — так карточка занимает одну строку вместо двух (экономия высоты).
        const playerBar = mobile.getAllByRole('progressbar')[0];
        expect(playerBar).toHaveClass('flex-1');
    });

    it('кнопки ± угла визуально 32px, но с расширенной до 44px зоной нажатия (#450)', () => {
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        const plus = mobile.getByRole('button', { name: 'Угол больше' });
        // Визуально компактная (size-8 = 32px), НЕ 44px-иконка.
        expect(plus).toHaveClass('size-8');
        expect(plus).not.toHaveClass('size-11');
        // Зона нажатия ≥44×44 — псевдоэлемент `before:-inset-2.5` расширяет бокс на
        // 10px во все стороны (52×52); тач-цель шире визуального бокса, раскладку
        // не растит. Проверяем точный класс: `-inset-2` дал бы лишь 48×48, а
        // substring `-inset-2` не отличил бы его от `-inset-2.5`.
        expect(plus).toHaveClass('before:-inset-2.5');
    });

    it('вся телеметрия (угол, сила, ветер, пипы) — один ряд (#450)', () => {
        const { getByTestId } = render(<TopHud />);
        const mobile = getByTestId('top-hud-mobile');

        // Угол-минус и пипы снарядов лежат в одном и том же ряду телеметрии
        // (последний прямой ребёнок колонки), а не в двух разных рядах, как было.
        const telemetryRow = mobile.children[mobile.children.length - 1];
        const contains = (el: Element, node: Element | null) => !!node && el.contains(node);
        const minusBtn = mobile.querySelector('button[aria-label="Угол меньше"]');
        const ammoPips = mobile.querySelector('[aria-label*="снарядов"]');
        expect(contains(telemetryRow, minusBtn)).toBe(true);
        expect(contains(telemetryRow, ammoPips)).toBe(true);
    });

    it('кнопка паузы 44px зовёт onPauseClick', () => {
        const onPauseClick = vi.fn();
        const { getByTestId } = render(<TopHud onPauseClick={onPauseClick} />);
        const mobile = within(getByTestId('top-hud-mobile'));

        const pauseButton = mobile.getByRole('button', { name: 'Пауза' });
        expect(pauseButton).toHaveClass('size-11');
        pauseButton.click();

        expect(onPauseClick).toHaveBeenCalledTimes(1);
    });

    it('кнопка mute переключает звук', () => {
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        expect(mobile.getByRole('button', { name: 'Выключить звук' })).toBeInTheDocument();
    });

    it('не показывает кнопки ± угла/силы в планшетной/десктопной раскладке (handoff: доводка только на тач-мобилке)', () => {
        const { getByTestId } = render(<TopHud />);
        const desktop = within(getByTestId('top-hud-desktop'));

        expect(desktop.queryByRole('button', { name: 'Угол больше' })).not.toBeInTheDocument();
        expect(desktop.queryByRole('button', { name: 'Сила больше' })).not.toBeInTheDocument();
    });

    // #473 — геометрия десктопного состава панели не зависит от значений: ячейки
    // и HP-карточки не «ездят» при смене угла/силы/HP/ветра (планшет/десктоп).

    it('десктоп: ширина ячейки угла зарезервирована под 360° при любом значении (#473)', () => {
        const cases = [0, -(40 * Math.PI) / 180, -(179 * Math.PI) / 180];
        for (const angle of cases) {
            useGameStore.setState({ angle, turn: 'player' });
            const { getByTestId, unmount } = render(<TopHud />);
            const desktop = within(getByTestId('top-hud-desktop'));

            // Невидимый размерник «360°» держит ширину бокса значения неизменной —
            // как `FixedNumeric` на мобилке. `aria-hidden`-селектор отсекает реальное
            // значение (при угле 0° оно тоже «360°», formatAngle(0) === 360).
            const sizer = desktop.getByText('360°', { selector: '[aria-hidden="true"]' });
            expect(sizer).toBeInTheDocument();
            unmount();
        }
    });

    it('десктоп: ширина ячейки силы зарезервирована под потолок POWER_MAX при любом значении (#473)', () => {
        for (const power of [1, 9, POWER_MAX]) {
            useGameStore.setState({ power, turn: 'player' });
            const { getByTestId, unmount } = render(<TopHud />);
            const desktop = within(getByTestId('top-hud-desktop'));

            const sizer = desktop.getByText(String(POWER_MAX), {
                selector: '[aria-hidden="true"]',
            });
            expect(sizer).toBeInTheDocument();
            unmount();
        }
    });

    it('десктоп: бокс ветра фиксирован под ряд пипов в обоих состояниях (пипы ↔ раскрытое число) (#473)', () => {
        // Пипы шире одиночной цифры — без резерва ячейка сужается при раскрытии.
        // Невидимый ряд пипов (aria-hidden) держит ширину в обоих состояниях.
        for (const windRevealed of [false, true]) {
            useGameStore.setState({ wind: MAX_WIND, windRevealed });
            const { getByTestId, unmount } = render(<TopHud />);
            const desktop = getByTestId('top-hud-desktop');

            const sizerPip = desktop.querySelector('[aria-hidden="true"] [data-testid="pip"]');
            expect(sizerPip).not.toBeNull();
            unmount();
        }
    });

    it('десктоп: подпись угла — «Угол» без «заморожен» на ходе бота (заморозку несёт бейдж) (#473)', () => {
        useGameStore.setState({ turn: 'enemy' });
        const { getByTestId } = render(<TopHud />);
        const desktop = within(getByTestId('top-hud-desktop'));

        expect(desktop.getByText('Угол')).toBeInTheDocument();
        expect(desktop.queryByText('Угол · заморожен')).not.toBeInTheDocument();
        // Заморозку на десктопе показывает бейдж рядом с пилюлей (#472) — на ходе
        // бота он видим (не `invisible`); сам бейдж декоративен (`aria-hidden`),
        // анонс несёт отдельный live-region (тест ниже).
        const badge = desktop.getByTestId('freeze-badge');
        expect(badge).not.toHaveClass('invisible');
        expect(badge).toHaveAttribute('aria-hidden', 'true');
    });

    it('десктоп: слот бейджа заморозки зарезервирован и на СВОЁМ ходу — бейдж present, invisible, aria-hidden (#472)', () => {
        useGameStore.setState({ turn: 'player' });
        const { getByTestId } = render(<TopHud />);
        const desktop = within(getByTestId('top-hud-desktop'));

        // Смысл компонента — не двигать пилюлю/иконки/телеметрию: на своём ходу
        // бейдж не размонтируется, лишь скрывается видимостью. Регрессию «стали
        // размонтировать на своём ходу» иначе ловит только тяжёлый e2e.
        const badge = desktop.getByTestId('freeze-badge');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveClass('invisible');
        expect(badge).toHaveAttribute('aria-hidden', 'true');
    });

    it('заморозку ввода анонсирует постоянный live-region: пуст на своём ходу, текст на ходе бота (a11y, #472)', () => {
        const { getByTestId, rerender } = render(<TopHud />);
        useGameStore.setState({ turn: 'player' });
        rerender(<TopHud />);

        const live = getByTestId('freeze-live');
        // Live-region (aria-live, без роли `status` — чтобы не конфликтовать с
        // тостом) смонтирован всегда и пуст на своём ходу — именно поэтому смена
        // его содержимого потом озвучивается.
        expect(live).toHaveAttribute('aria-live', 'polite');
        expect(live).not.toHaveAttribute('role');
        expect(live).toBeEmptyDOMElement();

        // Тот же узел (не пересоздан) наполняется текстом на ходе бота.
        useGameStore.setState({ turn: 'enemy' });
        rerender(<TopHud />);
        expect(getByTestId('freeze-live')).toHaveTextContent(
            'Твои числа заморожены до конца хода соперника',
        );
    });

    it('смену ветра бурей озвучивает живой регион, а не плашка на арене (#547)', () => {
        // Плашка `WindShiftBanner` монтируется на каждый показ (`key={nonce}`), а
        // появление узла скринридеры молчат — озвучивается смена содержимого уже
        // существующего live-region. Поэтому анонс живёт в HUD и смонтирован всегда.
        useGameStore.setState({ wind: 0.03, windShiftNonce: 0 });
        const { getByTestId, rerender } = render(<TopHud />);

        const live = getByTestId('wind-shift-live');
        expect(live).toHaveAttribute('aria-live', 'polite');
        expect(live).toBeEmptyDOMElement();

        // Буря сменила ветер: тот же узел наполняется текстом с НАПРАВЛЕНИЕМ — до #547
        // направление вообще не попадало в дерево доступности (стрелка декоративна).
        useGameStore.setState({ wind: -0.03, windShiftNonce: 1 });
        rerender(<TopHud />);
        expect(getByTestId('wind-shift-live')).toHaveTextContent(/Буря сменила ветер.*влево/);
    });

    it('ячейка ветра отдаёт направление и силу текстом (#547, a11y)', () => {
        useGameStore.setState({ wind: -0.03, windRevealed: true });
        const { getAllByRole } = render(<TopHud />);

        const groups = getAllByRole('group', { name: /Ветер/ });
        expect(groups.length).toBeGreaterThan(0);
        expect(groups[0]).toHaveAccessibleName(/Ветер влево, сила \d+ из \d+/);
    });

    // #447 — геометрия HUD не зависит ни от фазы боя, ни от значений.

    it('заметку о заморозке выводит из потока — absolute-оверлеем, не рядом (высота не растёт)', () => {
        useGameStore.setState({ turn: 'enemy' });
        const { getByTestId } = render(<TopHud />);

        const note = within(getByTestId('top-hud-mobile')).getByText(
            'Твои числа заморожены до конца хода соперника',
        );
        // absolute + pointer-events-none: узел не занимает места в колонке (высота
        // HUD одинакова с ходом игрока) и не перехватывает тач по арене.
        expect(note).toHaveClass('absolute');
        expect(note).toHaveClass('pointer-events-none');
    });

    it('на ходе игрока заметки о заморозке нет в DOM вовсе (оверлей рендерится только на ходе бота)', () => {
        useGameStore.setState({ turn: 'player' });
        const { getByTestId } = render(<TopHud />);

        expect(
            within(getByTestId('top-hud-mobile')).queryByText(
                'Твои числа заморожены до конца хода соперника',
            ),
        ).not.toBeInTheDocument();
    });

    it('ширина ячейки угла зарезервирована под максимум диапазона (360°) при любом значении', () => {
        const cases = [0, -(40 * Math.PI) / 180, -(179 * Math.PI) / 180];
        for (const angle of cases) {
            useGameStore.setState({ angle, turn: 'player' });
            const { getByTestId, unmount } = render(<TopHud />);
            const mobile = within(getByTestId('top-hud-mobile'));

            // Невидимый размерник с максимумом «360°» держит ширину бокса значения
            // неизменной, поэтому кнопки ± не ездят при смене числа знаков.
            const sizers = mobile.getAllByText('360°', { selector: '[aria-hidden="true"]' });
            expect(sizers.length).toBe(1);
            unmount();
        }
    });

    it('ширина ячейки силы зарезервирована под потолок POWER_MAX при любом значении', () => {
        for (const power of [1, 9, POWER_MAX]) {
            useGameStore.setState({ power, turn: 'player' });
            const { getByTestId, unmount } = render(<TopHud />);
            const mobile = within(getByTestId('top-hud-mobile'));

            const sizer = mobile.getByText(String(POWER_MAX), {
                selector: '[aria-hidden="true"]',
            });
            expect(sizer).toBeInTheDocument();
            unmount();
        }
    });

    it('бокс значения ветра фиксирован в обоих состояниях (пипы ↔ раскрытое число)', () => {
        // Не раскрыт: пипы. Раскрыт: число. В обоих случаях у бокса есть размерники
        // ширины (w-8 под компактный ряд пипов #450) и высоты — геометрия не меняется.
        for (const windRevealed of [false, true]) {
            useGameStore.setState({ wind: MAX_WIND, windRevealed });
            const { getByTestId, unmount } = render(<TopHud />);
            const mobile = getByTestId('top-hud-mobile');

            expect(mobile.querySelector('.w-8')).not.toBeNull();
            unmount();
        }
    });

    it('число HP зарезервировано под максимум («100/100») и выровнено вправо', () => {
        useGameStore.setState({ hp: { player: 9, enemy: 100 } });
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        const hpValue = mobile.getByText('9/100');
        expect(hpValue).toHaveClass('tabular-nums');
        expect(hpValue).toHaveClass('text-right');
        expect(hpValue.style.minWidth).toBe('7ch');
    });

    // #449 — барьер на регресс, найденный при написании e2e-теста по четырём
    // фазам: на планшете (768) первый ряд десктопной раскладки (HP-блок + пилюля
    // хода + иконки mute/пауза) собран `flex-wrap` без резерва под пилюлю. Три
    // подписи пилюли («ТВОЙ ХОД» / «ХОД СОПЕРНИКА» / «ВЫСТРЕЛ») разной длины
    // качали суммарную ширину ряда вокруг порога переноса — иконки то оставались
    // в первой строке, то переносились во вторую, и `top-hud` терял/приобретал
    // 68px высоты между фазами (воспроизведено e2e на 768). jsdom/happy-dom не
    // считает реальный layout (`getBoundingClientRect` всегда 0), поэтому здесь —
    // тот же приём, что и у числовых ячеек (`FixedNumeric`): проверяем, что
    // невидимый размерник с самой длинной подписью существует в DOM независимо
    // от текущего состояния, а не считаем пиксели.

    it('ширина пилюли хода зарезервирована под самую длинную подпись при любом состоянии (#449)', () => {
        const cases: Array<{ turn: 'player' | 'enemy'; phase: 'aiming' | 'flight' | 'over' }> = [
            { turn: 'player', phase: 'aiming' },
            { turn: 'enemy', phase: 'aiming' },
            { turn: 'player', phase: 'flight' },
            { turn: 'enemy', phase: 'flight' },
            { turn: 'enemy', phase: 'over' },
        ];
        for (const state of cases) {
            useGameStore.setState(state);
            const { getByTestId, unmount } = render(<TopHud />);
            const mobile = within(getByTestId('top-hud-mobile'));

            const sizer = mobile.getByText('ХОД СОПЕРНИКА', { selector: '[aria-hidden="true"]' });
            expect(sizer).toBeInTheDocument();
            unmount();
        }
    });

    it('высота колонки top-hud-mobile не зависит от хода бота и от раскрытия ветра (число рядов не меняется)', () => {
        const states = [
            { turn: 'player' as const, windRevealed: false },
            { turn: 'enemy' as const, windRevealed: false },
            { turn: 'player' as const, windRevealed: true },
            { turn: 'enemy' as const, windRevealed: true },
        ];
        const rowCounts = states.map((state) => {
            useGameStore.setState({ ...state, wind: MAX_WIND });
            const { getByTestId, unmount } = render(<TopHud />);
            // Прямые дети колонки — это ряды (#447: заметка о заморозке и
            // раскрытие ветра выведены из потока `absolute`/остаются в той же
            // грид-ячейке, а не добавляют новый ряд).
            const rowCount = getByTestId('top-hud-mobile').children.length;
            unmount();
            return rowCount;
        });

        for (const count of rowCounts) {
            expect(count).toBe(rowCounts[0]);
        }
    });
});

// #537 — клип HUD на 320px: ряд телеметрии переполняется, ячейка ресурсов вытолкнута,
// кнопка паузы срезана. Решение: сжимать элементы по порядку приоритета.
//
// ЗДЕСЬ ЭТОГО ТЕСТА НЕТ НАМЕРЕННО. Стоявшая на этом месте проверка
// `scrollWidth <= clientWidth + 1` в happy-dom не могла упасть никогда: раскладка не
// считается, обе величины равны нулю, и ассерт сводился к `0 <= 1`. Комментарий обещал
// «мимикрируем 320px viewport», но ширина нигде не задавалась, а выборка
// `querySelectorAll(':scope > .flex')` при смене класса рядов молча давала пустой список —
// то есть барьер был фальшивым дважды.
//
// Переполнение — свойство РАСКЛАДКИ, и проверяется там, где она есть: в браузере.
// Сторожит `e2e/mobile-viewport.spec.ts` — пара тестов на 320 и 390: на 320 панель влезает
// и второстепенное схлопнуто, на 390 схлопнутое возвращается. Дублировать это здесь
// нечем: любая проверка ширины в happy-dom будет ровно такой же тавтологией.
