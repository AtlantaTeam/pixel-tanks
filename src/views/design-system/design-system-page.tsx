import { APP_NAME } from '@/shared/config';
import { DesignSystemPreview } from './design-system-preview';

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

const BRAND_TOKENS: TSwatch[] = [
    { name: '--color-primary', hex: '#ffc21f' },
    { name: '--color-primary-ink', hex: '#241900' },
    { name: '--color-accent', hex: '#48ff00' },
    { name: '--color-accent-ink', hex: '#052400' },
    { name: '--color-enemy', hex: '#c900ff' },
    { name: '--color-enemy-ink', hex: '#1e0030' },
    { name: '--color-danger', hex: '#ff4242' },
    { name: '--color-danger-ink', hex: '#2b0000' },
    { name: '--color-warning', hex: '#ffa900' },
    { name: '--color-warning-ink', hex: '#2a1600' },
    { name: '--color-success', hex: '#48ff00' },
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

type TEffect = {
    name: string;
    kind: 'box' | 'text';
    hint: string;
};

const EFFECTS: TEffect[] = [
    { name: '--glow-primary', kind: 'box', hint: 'Свечение primary-кнопок' },
    { name: '--glow-accent', kind: 'box', hint: 'Свечение неоновых обводок' },
    { name: '--glow-enemy', kind: 'box', hint: 'Вражеский glow (тема enemy)' },
    { name: '--glow-danger', kind: 'box', hint: 'Свечение danger (поражение)' },
    { name: '--glow-text', kind: 'text', hint: 'Свечение HUD-цифр и лого' },
    { name: '--edge-pixel', kind: 'box', hint: 'Жёсткая пиксель-тень объёма' },
    { name: '--ring-focus', kind: 'box', hint: 'Клавиатурный фокус (двойной ринг)' },
];

type TRadius = {
    name: string;
    value: string;
    hint: string;
};

const RADII: TRadius[] = [
    { name: '--radius-none', value: '0px', hint: 'Панели, кнопки — острые углы' },
    { name: '--radius-sm', value: '2px', hint: 'Лёгкое смягчение (чипы, бейджи)' },
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

function SectionHeading({ children }: { children: string }) {
    return <h2 className="mb-6 font-display text-h2 text-text uppercase">{children}</h2>;
}

export function DesignSystemPage() {
    return (
        <main className="min-h-dvh bg-bg px-4 py-10 text-text sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-6xl flex-col gap-14">
                <header className="flex flex-col gap-3">
                    <p className="font-ui text-label tracking-[0.12em] text-accent uppercase">
                        {APP_NAME} · Design System
                    </p>
                    <h1 className="font-display text-display text-text uppercase">Витрина</h1>
                    <p className="max-w-prose text-body text-text-muted">
                        Живой справочник дизайн-системы в реальном Next / Tailwind окружении:
                        токены, типографика, компоненты и эффекты из hero-арта. Мишень визуальной
                        регрессии.
                    </p>
                </header>

                <section>
                    <SectionHeading>Палитра</SectionHeading>
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
                                    <Swatch key={token.name} {...token} />
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section>
                    <SectionHeading>Типографика</SectionHeading>
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
                                <p className={`${role.className} ${role.fontClassName} text-text`}>
                                    {role.sample}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <SectionHeading>Компоненты</SectionHeading>
                    <DesignSystemPreview />
                </section>

                <section>
                    <SectionHeading>Эффекты</SectionHeading>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {EFFECTS.map((effect) => (
                            <div key={effect.name} className="flex flex-col gap-3">
                                <div className="flex h-28 items-center justify-center bg-surface">
                                    {effect.kind === 'text' ? (
                                        <span
                                            className="font-display text-hud-xl text-accent"
                                            style={{ textShadow: `var(${effect.name})` }}
                                        >
                                            HUD
                                        </span>
                                    ) : (
                                        <div
                                            aria-hidden
                                            className="size-12 bg-panel-raised"
                                            style={{ boxShadow: `var(${effect.name})` }}
                                        />
                                    )}
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="font-ui text-caption text-text">
                                        {effect.name}
                                    </span>
                                    <span className="font-ui text-label text-text-muted">
                                        {effect.hint}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <SectionHeading>Радиусы</SectionHeading>
                    <p className="mb-6 max-w-prose text-body text-text-muted">
                        Пиксельная эстетика — почти без скруглений. <code>--radius-none</code>{' '}
                        держит острые углы панелей и кнопок, <code>--radius-sm</code> (2px) лишь
                        слегка смягчает мелкие элементы.
                    </p>
                    <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                        {RADII.map((radius) => (
                            <div key={radius.name} className="flex flex-col gap-3">
                                <div
                                    aria-hidden
                                    className="h-20 w-full border-[length:var(--border-w)] border-border-strong bg-panel-raised"
                                    style={{ borderRadius: `var(${radius.name})` }}
                                />
                                <div className="flex flex-col gap-0.5">
                                    <span className="font-ui text-caption text-text">
                                        {radius.name}
                                    </span>
                                    <span className="font-ui text-label text-text-muted">
                                        {radius.value} · {radius.hint}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <SectionHeading>Тема</SectionHeading>
                    <p className="mb-6 max-w-prose text-body text-text-muted">
                        Ось тем — фракция. Переключатель ниже меняет <code>data-faction</code> на
                        контейнере-обёртке; компоненты читают семантические
                        <code> --accent / --glow</code> и переключаются без условных классов в
                        разметке.
                    </p>
                    <p className="text-caption text-text-muted">
                        Интерактивный переключатель — в секции «Компоненты» выше.
                    </p>
                </section>
            </div>
        </main>
    );
}
