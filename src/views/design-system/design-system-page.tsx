'use client';

import { useState } from 'react';
import { APP_NAME } from '@/shared/config';
import { ThemeScope, type TFaction, type TIntensity } from '@/shared/lib/theme';
import { SegmentedControl, type TSegmentedControlOption } from '@/shared/ui';
import { AtomicComponentsSection } from './atomic-components-section';
import { BaseComponentsSection } from './base-components-section';
import { DecisionsSection } from './decisions-section';
import { DisplayFontSection } from './display-font-section';
import { EffectTokensSection } from './effect-tokens-section';
import { FeedbackStatesSection } from './feedback-states-section';
import { GameControlsSection } from './game-controls-section';
import { GameOverSection } from './game-over-section';
import { IconSection } from './icon-section';
import { PauseSection } from './pause-section';
import { PrecipitationSection } from './precipitation-section';
import { ScreensSection } from './screens-section';
import { SkyBackgroundSection } from './sky-background-section';
import { TankSkinsSection } from './tank-skins-section';
import { WeaponsSection } from './weapons-section';
import { WindDustSection } from './wind-dust-section';

const FACTION_OPTIONS: TSegmentedControlOption<TFaction>[] = [
    { value: 'player', label: 'Игрок' },
    { value: 'enemy', label: 'Враг' },
];

const INTENSITY_OPTIONS: TSegmentedControlOption<TIntensity>[] = [
    { value: 'normal', label: 'Неон' },
    { value: 'calm', label: 'Спокойный HUD' },
];

type TSwatch = {
    name: string;
    hex: string;
    contrast?: string;
};

const SURFACE_TOKENS: TSwatch[] = [
    { name: '--color-bg', hex: '#080c08' },
    { name: '--color-surface', hex: '#101711' },
    { name: '--color-panel', hex: '#18221a' },
    { name: '--color-panel-raised', hex: '#212f24' },
    { name: '--color-border', hex: '#2c3f30' },
    { name: '--color-border-strong', hex: '#3f5a41' },
    { name: '--color-muted', hex: '#33452f' },
];

const TEXT_TOKENS: TSwatch[] = [
    { name: '--color-text', hex: '#e9f5e6', contrast: '~15:1 AAA' },
    { name: '--color-text-muted', hex: '#a2bb9d', contrast: '~7.5:1 AA' },
    { name: '--color-text-dim', hex: '#728a70', contrast: '~3.6:1' },
];

type TBrandToken = {
    name: string;
    hex: string;
    /** Токен `-ink` этой заливки — показан как контраст-подпись НА свотче
     *  (D5 §05: ink-пары — это текст поверх заливки, не отдельные боксы). */
    inkName: string;
    /** Роль/контекст использования — «роль-подписи цветов» инвентаря. */
    role: string;
};

const BRAND_TOKENS: TBrandToken[] = [
    {
        name: '--color-primary',
        hex: '#ffc21f',
        inkName: '--color-primary-ink',
        role: 'действие · золото',
    },
    {
        name: '--color-accent',
        hex: '#48ff00',
        inkName: '--color-accent-ink',
        role: 'фокус · выбор · свой (тема через data-faction)',
    },
    {
        name: '--color-enemy',
        hex: '#c900ff',
        inkName: '--color-enemy-ink',
        role: 'враг · маджента',
    },
    {
        name: '--color-danger',
        hex: '#ff4242',
        inkName: '--color-danger-ink',
        role: 'поражение · удаление · ошибки',
    },
    {
        name: '--color-warning',
        hex: '#ffa900',
        inkName: '--color-warning-ink',
        role: 'предупреждение',
    },
    {
        name: '--color-success',
        hex: '#48ff00',
        inkName: '--color-accent-ink',
        role: '= accent, алиас (D1)',
    },
];

type TTypeRole = {
    name: string;
    className: string;
    fontClassName: string;
    size: string;
    sample: string;
};

const TYPE_ROLES: TTypeRole[] = [
    {
        name: '--text-display',
        className: 'text-display',
        fontClassName: 'font-display',
        size: 'clamp(48px, 7vw, 96px)',
        sample: 'ПИКСЕЛЬ ТАНКИ',
    },
    {
        name: '--text-h1',
        className: 'text-h1',
        fontClassName: 'font-display',
        size: '40px',
        sample: 'Заголовок экрана',
    },
    {
        name: '--text-h2',
        className: 'text-h2',
        fontClassName: 'font-display',
        size: '28px',
        sample: 'Заголовок секции',
    },
    {
        name: '--text-hud-xl',
        className: 'text-hud-xl',
        fontClassName: 'font-ui',
        size: '40px',
        sample: '1280',
    },
    {
        name: '--text-hud',
        className: 'text-hud',
        fontClassName: 'font-ui',
        size: '20px',
        sample: 'УГОЛ 45°',
    },
    {
        name: '--text-button',
        className: 'text-button',
        fontClassName: 'font-ui',
        size: '16px',
        sample: 'ОГОНЬ',
    },
    {
        name: '--text-body',
        className: 'text-body',
        fontClassName: 'font-ui',
        size: '16px',
        sample: 'Основной текст интерфейса — читается часами.',
    },
    {
        name: '--text-caption',
        className: 'text-caption',
        fontClassName: 'font-ui',
        size: '13px',
        sample: 'Мелкая подпись и вторичные данные.',
    },
    {
        name: '--text-label',
        className: 'text-label',
        fontClassName: 'font-ui',
        size: '11px',
        sample: 'МЕТКА ПОЛЯ',
    },
];

function Swatch({ name, hex, contrast }: TSwatch) {
    const label = name.replace(/^--color-/, '');
    return (
        <div className="flex flex-col gap-2">
            <div
                aria-hidden
                className="h-16 w-full border-[length:var(--border-w)] border-border"
                style={{ backgroundColor: `var(${name})` }}
            />
            <div className="flex flex-col gap-0.5">
                <span className="font-ui text-caption text-text">{label}</span>
                <span className="font-ui text-label text-text-muted uppercase">{hex}</span>
                {contrast && (
                    <span className="font-ui text-label text-text-muted">Контраст {contrast}</span>
                )}
            </div>
        </div>
    );
}

/** Бренд/статус-свотч с ink-парой ПРЯМО на заливке (пример: primary-ink текстом
 *  поверх primary), а не отдельным боксом — D4 §05 инвентаря. */
function BrandSwatch({ name, hex, inkName, role }: TBrandToken) {
    const label = name.replace(/^--color-/, '');
    return (
        <div className="flex flex-col gap-2">
            <div
                aria-hidden
                className="flex h-16 w-full items-center justify-center border-[length:var(--border-w)] border-border font-ui text-[11px] font-bold uppercase"
                style={{ backgroundColor: `var(${name})`, color: `var(${inkName})` }}
            >
                Aa
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="font-ui text-caption text-text">{label}</span>
                <span className="font-ui text-label text-text-muted uppercase">{hex}</span>
                <span className="font-ui text-label text-text-muted">{role}</span>
            </div>
        </div>
    );
}

function SectionHeading({
    number,
    headline,
    children,
}: {
    number: string;
    headline?: string;
    children: string;
}) {
    return (
        <div className="mb-6 flex flex-col gap-1">
            <p className="font-ui text-label tracking-[0.28em] text-accent uppercase">
                {number} — {children}
            </p>
            <h2 className="font-display text-h2 text-text uppercase">{headline ?? children}</h2>
        </div>
    );
}

export function DesignSystemPage() {
    const [faction, setFaction] = useState<TFaction>('player');
    const [intensity, setIntensity] = useState<TIntensity>('normal');

    return (
        <ThemeScope
            faction={faction}
            intensity={intensity}
            data-testid="ds-faction-scope"
            className="block min-h-dvh bg-bg text-text"
        >
            <main className="px-4 py-10 sm:px-6 lg:px-10">
                <div className="mx-auto flex max-w-6xl flex-col gap-22">
                    <header className="flex flex-col gap-5.5">
                        <p className="font-ui text-label tracking-[0.32em] text-accent uppercase">
                            {APP_NAME} · Design System · Extended Inventory
                        </p>
                        <h1 className="font-display text-display text-text uppercase break-words">
                            Полный инвентарь
                            <br />
                            компонентов и экранов
                        </h1>
                        <p className="max-w-prose text-body text-text-muted">
                            Живой справочник дизайн-системы в реальном Next / Tailwind окружении:
                            токены, типографика, компоненты и эффекты из hero-арта. Живые примеры
                            реагируют на переключатели ниже. Упаковка — Telegram Mini App, поэтому
                            всё адаптивно от 390px и без десктоп-онли хрома. Мишень визуальной
                            регрессии.
                        </p>

                        <div className="mt-1 flex flex-wrap items-center gap-5.5">
                            <div className="flex items-center gap-3">
                                <span
                                    id="ds-faction-switch-label"
                                    className="font-ui text-label tracking-[0.14em] text-text-muted uppercase"
                                >
                                    Тема акцента
                                </span>
                                <SegmentedControl
                                    label="Тема акцента"
                                    labelledBy="ds-faction-switch-label"
                                    options={FACTION_OPTIONS}
                                    value={faction}
                                    onChange={setFaction}
                                />
                            </div>
                            <div className="flex items-center gap-3">
                                <span
                                    id="ds-intensity-switch-label"
                                    className="font-ui text-label tracking-[0.14em] text-text-muted uppercase"
                                >
                                    Интенсивность (data-intensity)
                                </span>
                                <SegmentedControl
                                    label="Интенсивность"
                                    labelledBy="ds-intensity-switch-label"
                                    options={INTENSITY_OPTIONS}
                                    value={intensity}
                                    onChange={setIntensity}
                                />
                            </div>
                        </div>
                    </header>

                    <section>
                        <SectionHeading number="01">Палитра</SectionHeading>
                        <div className="flex flex-col gap-8">
                            <div>
                                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                                    Поверхности
                                </h3>
                                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                                    {SURFACE_TOKENS.map((token) => (
                                        <Swatch key={token.name} {...token} />
                                    ))}
                                </div>
                            </div>
                            <div>
                                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                                    Текст
                                </h3>
                                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                                    {TEXT_TOKENS.map((token) => (
                                        <Swatch key={token.name} {...token} />
                                    ))}
                                </div>
                            </div>
                            <div>
                                <h3 className="mb-3 font-ui text-hud text-text-muted uppercase">
                                    Бренд / статус
                                </h3>
                                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                                    {BRAND_TOKENS.map((token) => (
                                        <BrandSwatch key={token.name} {...token} />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <SectionHeading number="02">Типографика</SectionHeading>
                        <div className="flex flex-col gap-8">
                            {TYPE_ROLES.map((role) => (
                                <div
                                    key={role.name}
                                    className="flex flex-col gap-2 border-b border-border pb-6 last:border-b-0 md:flex-row md:items-baseline md:gap-8"
                                >
                                    <div className="flex shrink-0 flex-col gap-0.5 md:w-56">
                                        <span className="font-ui text-caption text-text">
                                            {role.name}
                                        </span>
                                        <span className="font-ui text-label text-text-muted uppercase">
                                            {role.size}
                                        </span>
                                    </div>
                                    <p
                                        className={`${role.className} ${role.fontClassName} text-text`}
                                    >
                                        {role.sample}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <SectionHeading number="03">Компоненты</SectionHeading>
                        <BaseComponentsSection />
                    </section>

                    <section>
                        <SectionHeading number="04">Тема</SectionHeading>
                        <p className="mb-2 max-w-prose text-body text-text-muted">
                            Ось тем — фракция. Переключатель в шапке страницы меняет{' '}
                            <code>data-faction</code> на корневой обёртке витрины — компоненты
                            читают семантические <code>--accent / --glow</code> и переключаются без
                            условных классов в разметке.
                        </p>
                        <p className="text-caption text-text-muted">
                            Попробуй прямо сейчас: переключи «Тема акцента» / «Интенсивность» в
                            шапке — вся витрина ниже реагирует.
                        </p>
                    </section>

                    <section>
                        <SectionHeading number="05" headline="Нестыковки решены явно">
                            Решения
                        </SectionHeading>
                        <DecisionsSection />
                    </section>

                    <section>
                        <SectionHeading number="06" headline="Glow · edge · focus · radius">
                            Эффект-токены
                        </SectionHeading>
                        <EffectTokensSection />
                    </section>

                    <section>
                        <SectionHeading number="07" headline="Пиксельный набор · сетка 16×16">
                            Иконки
                        </SectionHeading>
                        <IconSection />
                    </section>

                    <section>
                        <SectionHeading number="08" headline="Инвентарь · все состояния">
                            Новые компоненты
                        </SectionHeading>
                        <AtomicComponentsSection />
                    </section>

                    <section>
                        <SectionHeading number="09" headline="Кнопки · данные · формы">
                            Состояния
                        </SectionHeading>
                        <FeedbackStatesSection />
                    </section>

                    <section>
                        <SectionHeading number="10" headline="Тач-рогатка · плеер реплея">
                            Игровые контролы
                        </SectionHeading>
                        <GameControlsSection />
                    </section>

                    <section>
                        <SectionHeading number="11" headline="Поток · все брейкпоинты">
                            Экраны
                        </SectionHeading>
                        <ScreensSection />
                    </section>

                    <section>
                        <SectionHeading number="12" headline="Пауза / Настройки боя">
                            Новый экран
                        </SectionHeading>
                        <PauseSection />
                    </section>

                    <section>
                        <SectionHeading number="13" headline="Конец боя — все исходы">
                            Game Over
                        </SectionHeading>
                        <GameOverSection />
                    </section>

                    <section>
                        <SectionHeading number="14" headline="Кириллица заголовков — решение D7">
                            Дисплейный шрифт
                        </SectionHeading>
                        <DisplayFontSection />
                    </section>

                    <section>
                        <SectionHeading number="15" headline="День · закат · ночь — пресет от сида">
                            Небо боя
                        </SectionHeading>
                        <SkyBackgroundSection />
                    </section>

                    <section>
                        <SectionHeading
                            number="16"
                            headline="Геометрии × палитры — выбор косметики"
                        >
                            Скины танков
                        </SectionHeading>
                        <TankSkinsSection />
                    </section>

                    <section>
                        <SectionHeading
                            number="17"
                            headline="Снаряды и взрывы четырёх типов — числа WEAPON_SPECS"
                        >
                            Оружие боя
                        </SectionHeading>
                        <WeaponsSection />
                    </section>

                    <section>
                        <SectionHeading
                            number="18"
                            headline="Ясно · дождь · снег · буря — пресет от сида"
                        >
                            Погода боя
                        </SectionHeading>
                        <PrecipitationSection />
                    </section>

                    <section>
                        <SectionHeading
                            number="19"
                            headline="Пылинки приземного слоя и ночная кайма — носитель ветра"
                        >
                            Ветер в арене
                        </SectionHeading>
                        <WindDustSection />
                    </section>
                </div>
            </main>
        </ThemeScope>
    );
}
