import { clsx } from 'clsx';
import { APP_NAME } from '@/shared/config';
import type { TSegmentedControlOption } from '@/shared/ui';
import { Button, FactionBadge, Icon, SegmentedControl, TextInput } from '@/shared/ui';
import type { TScreenVariant } from './frameset';

const noop = () => {};

const MODE_OPTIONS: TSegmentedControlOption<'signin' | 'signup'>[] = [
    { value: 'signin', label: 'Вход' },
    { value: 'signup', label: 'Регистрация' },
];

const FACTIONS = [
    { faction: 'player', title: 'Зелёные', hint: 'Свои · неон' },
    { faction: 'enemy', title: 'Пурпурные', hint: 'Враг · маджента' },
] as const;

/** Выбор фракции-аватара при регистрации (screens-briefs-detailed.md §3):
 *  выбранный вариант подсвечен --accent, невыбранный — обычной рамкой. */
function FactionChoice() {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="font-ui text-label font-bold tracking-[0.12em] text-text-muted uppercase">
                Фракция
            </span>
            <div className="flex gap-2">
                {FACTIONS.map((option, index) => (
                    <div
                        key={option.faction}
                        className={clsx(
                            'flex flex-1 items-center gap-3 border-[length:var(--border-w)] bg-surface px-3 py-2.5',
                            index === 0
                                ? 'border-[color:var(--accent)] shadow-[var(--glow)]'
                                : 'border-border-strong',
                        )}
                    >
                        <FactionBadge faction={option.faction} size="sm" />
                        <span className="flex flex-col gap-0.5">
                            <span className="font-ui text-caption font-bold text-text">
                                {option.title}
                            </span>
                            <span className="font-ui text-label text-text-muted">
                                {option.hint}
                            </span>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function LoginForm() {
    return (
        <div className="flex flex-col gap-4 border-[length:var(--border-w-thick)] border-border bg-panel p-6 shadow-[var(--shadow-panel)]">
            <SegmentedControl
                options={MODE_OPTIONS}
                value="signup"
                onChange={noop}
                label="Вход или регистрация"
                className="w-full"
            />
            <TextInput label="Позывной" placeholder="rex_commander" defaultValue="rex_commander" />
            <TextInput
                type="email"
                label="Email"
                placeholder="commander@tanks.io"
                defaultValue="commander@tanks.io"
            />
            <TextInput type="password" label="Пароль" defaultValue="artillery" />
            <FactionChoice />
            <Button variant="primary" className="m-0 w-full">
                Создать бойца
            </Button>
            <div className="flex items-center justify-between">
                <span className="font-ui text-caption text-text-dim">Забыли пароль?</span>
                <span className="flex items-center gap-1.5 font-ui text-caption text-text-muted">
                    <Icon name="info" size={13} />
                    Только email · без соцсетей
                </span>
            </div>
        </div>
    );
}

/** Арт-колонка планшета/десктопа: логотип и обещание боя. Реальный hero-арт —
 *  сменяемый ассет, кадр держит только оболочку (см. ArenaPlaceholder). */
function LoginHero({ variant }: { variant: TScreenVariant }) {
    return (
        <div className="relative flex flex-1 flex-col justify-center gap-4 overflow-hidden border-r-[length:var(--border-w)] border-border bg-[linear-gradient(160deg,var(--color-panel)_0%,var(--color-bg)_70%)] px-10">
            <span className="font-ui text-label tracking-[0.32em] text-accent uppercase">
                Артиллерийская дуэль
            </span>
            <p className="font-display text-h1 text-text uppercase">{APP_NAME}</p>
            <p className="max-w-[380px] font-ui text-body text-text-muted">
                Угол, сила, ветер — три числа решают бой. Пять снарядов на танк, четыре хода на
                манёвр, разрушаемый рельеф.
            </p>
            {variant === 'desktop' && (
                <div className="flex items-center gap-3 font-ui text-caption text-text-dim">
                    <Icon name="target" size={16} />
                    Бой дня · единый seed для всех
                </div>
            )}
        </div>
    );
}

export function LoginScreenFrame({ variant }: { variant: TScreenVariant }) {
    if (variant === 'mobile') {
        return (
            <div className="flex h-full w-full flex-col gap-5 bg-bg px-4 pt-8 pb-6">
                <div className="flex flex-col gap-1.5">
                    <span className="font-ui text-label tracking-[0.28em] text-accent uppercase">
                        Артиллерийская дуэль
                    </span>
                    <p className="font-display text-h2 text-text uppercase">{APP_NAME}</p>
                </div>
                <LoginForm />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full bg-bg">
            <LoginHero variant={variant} />
            <div className="flex flex-1 items-center justify-center px-8">
                <div className="w-full max-w-[420px]">
                    <LoginForm />
                </div>
            </div>
        </div>
    );
}
