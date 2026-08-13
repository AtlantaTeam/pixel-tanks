import type { ComponentType, ReactNode } from 'react';
import { DailyScreenFrame } from './daily-screen-frame';
import { frameset, type TScreenVariant } from './frameset';
import { GameScreenFrame } from './game-screen-frame';
import { GameScreenFreezeBadgeRow, GameScreenStatesRow } from './game-screen-states';
import { LoginScreenFrame } from './login-screen-frame';
import { OnboardingScreenFrame } from './onboarding-screen-frame';
import { ProfileScreenFrame } from './profile-screen-frame';
import { ReplayScreenFrame } from './replay-screen-frame';
import { ScreenFrame } from './screen-frame';
import { UtilityScreenFrame } from './utility-screen-frame';

type TScreenEntry = {
    title: string;
    note: string;
    Component: ComponentType<{ variant: TScreenVariant }>;
    /** Явный testid ряда кадров брейкпоинтов — тест-хук не выводим из наличия
     *  `renderStates`: как только второй экран заведёт состояния, он не должен
     *  ошибочно получить игро-специфичный `game-screen-breakpoints`. Пока задан
     *  только игровому экрану (#427). */
    framesTestId?: string;
    /** Доп. ряд под кадрами брейкпоинтов — состояния экрана (handoff
     *  «Взаимодействия и состояния»), которых по определению нет в четырёх
     *  срезах одного и того же (дефолтного) состояния. Пока нужен только
     *  игровому экрану (#427) — остальные экраны его не задают. */
    renderStates?: () => ReactNode;
};

/** Заголовки и note — дословно из design-inventory.dc.html §11 (JS-конфиг `screens`),
 *  порядок каталога тот же: нумерация витрины совпадает с инвентарём 1:1.
 *  Состав каждого экрана — docs/design-system-theming/screens-briefs-detailed.md. */
const SCREENS: TScreenEntry[] = [
    {
        title: 'Логин / Регистрация',
        note: 'email+пароль, без Google, выбор фракции · 1 кол → 2 кол (арт+форма) на планшете+',
        Component: LoginScreenFrame,
    },
    {
        title: 'Профиль',
        note: 'аватар-фракция, статистика, история боёв + реплеи · стек → сайдбар+сетка',
        Component: ProfileScreenFrame,
    },
    {
        title: 'Бой дня',
        note: 'вызов + результат/сравнение + лидерборд дня, табы День/Всё время',
        Component: DailyScreenFrame,
    },
    {
        title: 'Реплей / Поделиться',
        note: 'плеер + карточка шеринга',
        Component: ReplayScreenFrame,
    },
    {
        title: 'Онбординг «Как играть»',
        note: '3 шага, пиктограммы, пагинация',
        Component: OnboardingScreenFrame,
    },
    {
        title: 'Игровой экран (mobile-first)',
        note: 'Canvas + HUD + тач-рогатка; десктоп — HUD-бар сверху',
        Component: GameScreenFrame,
        framesTestId: 'game-screen-breakpoints',
        renderStates: () => (
            <>
                <GameScreenStatesRow />
                <GameScreenFreezeBadgeRow />
            </>
        ),
    },
    {
        title: 'Utility · загрузка / 404 / ошибка',
        note: 'переиспользуемые заглушки',
        Component: UtilityScreenFrame,
    },
];

const FRAMES = frameset();

export function ScreensCatalog() {
    return (
        <div className="flex min-w-0 flex-col gap-10">
            {SCREENS.map(({ title, note, Component, framesTestId, renderStates }) => (
                <section key={title} className="flex min-w-0 flex-col gap-4">
                    <div className="flex flex-wrap items-baseline gap-3 border-b-[length:var(--border-w)] border-border pb-2.5">
                        <h3 className="font-display text-h2 text-text uppercase">{title}</h3>
                        <span className="font-ui text-caption text-text-muted">{note}</span>
                    </div>
                    {/* Кадры — фиксированной ширины (до 576px у wide), поэтому на узком
                        окне прокручивается сама лента, а не страница витрины. */}
                    <div
                        data-testid={framesTestId}
                        className="flex min-w-0 flex-wrap items-start gap-5 overflow-x-auto pb-2"
                    >
                        {FRAMES.map((frame) => (
                            <ScreenFrame key={frame.label} frame={frame}>
                                <Component variant={frame.variant} />
                            </ScreenFrame>
                        ))}
                    </div>
                    {renderStates?.()}
                </section>
            ))}
        </div>
    );
}
