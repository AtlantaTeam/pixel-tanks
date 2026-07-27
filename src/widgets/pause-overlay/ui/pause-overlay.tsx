'use client';

import { useState, type ReactNode } from 'react';
import { ThemeScope } from '@/shared/lib/theme';
import {
    Button,
    Dialog,
    Icon,
    SegmentedControl,
    Toggle,
    type TSegmentedControlOption,
} from '@/shared/ui';

export type TPauseLanguage = 'RU' | 'EN';
// Стабильные ключи-идентичности значения, не RU-подписи: на шаге 10 (i18n) UI
// переводится, а значения/тип остаются те же. Видимая подпись — в `label`.
export type TPauseDifficulty = 'rookie' | 'shooter' | 'terminator';

// RU/EN — это коды языков, поэтому value === label здесь легитимно (не копирайт).
const LANGUAGE_OPTIONS: TSegmentedControlOption<TPauseLanguage>[] = [
    { value: 'RU', label: 'RU' },
    { value: 'EN', label: 'EN' },
];

const DIFFICULTY_OPTIONS: TSegmentedControlOption<TPauseDifficulty>[] = [
    { value: 'rookie', label: 'Новобранец' },
    { value: 'shooter', label: 'Стрелок' },
    { value: 'terminator', label: 'Терминатор' },
];

type TPauseOverlayProps = {
    open: boolean;
    onResume: () => void;
    onRestart: () => void;
    onExitToMenu: () => void;
};

/** Подпись секции настроек — единый стиль на все заголовки оверлея (Звук,
 *  Отображение, Язык, Сложность), чтобы при правке стиля один не отстал. */
function SectionLabel({ id, children }: { id?: string; children: ReactNode }) {
    return (
        <p id={id} className="font-ui text-label text-text-muted uppercase tracking-[0.14em]">
            {children}
        </p>
    );
}

/** Горизонтальный разделитель между секциями настроек. */
function Divider() {
    return <div className="h-0.5 bg-border" />;
}

/** design-inventory.dc.html §12 «Экран паузы»: оверлей поверх затемнённой арены.
 *  Настройки звука/HUD/языка/сложности — плейсхолдер: хранятся в локальном
 *  `useState` и наружу пока не выведены. Подключение реального стора звука (шаг 6)
 *  и i18n (шаг 10) потребует расширения пропсов (value/onChange на настройки). */
export function PauseOverlay({ open, onResume, onRestart, onExitToMenu }: TPauseOverlayProps) {
    const [soundOn, setSoundOn] = useState(true);
    const [musicOn, setMusicOn] = useState(true);
    const [fxOn, setFxOn] = useState(true);
    const [calm, setCalm] = useState(false);
    const [language, setLanguage] = useState<TPauseLanguage>('RU');
    const [difficulty, setDifficulty] = useState<TPauseDifficulty>('shooter');

    return (
        <ThemeScope intensity={calm ? 'calm' : 'normal'} className="contents">
            <Dialog
                open={open}
                onClose={onResume}
                className="p-0 text-left"
                aria-labelledby="pause-overlay-title"
            >
                <div className="flex items-center justify-between border-b-[length:var(--border-w)] border-border px-5 py-4">
                    <h2
                        id="pause-overlay-title"
                        className="font-display text-h2 text-text uppercase [text-shadow:var(--glow)]"
                    >
                        Пауза
                    </h2>
                    <button
                        type="button"
                        aria-label="Закрыть"
                        onClick={onResume}
                        className="flex size-9 cursor-pointer items-center justify-center border-[length:var(--border-w)] border-border-strong text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                        <Icon name="close" size={16} />
                    </button>
                </div>

                <div className="flex flex-col gap-4.5 px-5 py-5">
                    <div className="flex flex-col gap-3.5">
                        <SectionLabel>Звук</SectionLabel>
                        <Toggle label="Общий звук" checked={soundOn} onChange={setSoundOn} />
                        <div className="flex flex-col gap-3.5 border-l-[length:var(--border-w)] border-border pl-3.5">
                            <Toggle
                                label="Музыка"
                                sublabel="фоновая тема"
                                checked={musicOn}
                                disabled={!soundOn}
                                onChange={setMusicOn}
                            />
                            <Toggle
                                label="Эффекты"
                                sublabel="выстрелы, взрывы"
                                checked={fxOn}
                                disabled={!soundOn}
                                onChange={setFxOn}
                            />
                        </div>
                    </div>

                    <Divider />

                    <div className="flex flex-col gap-3.5">
                        <SectionLabel>Отображение</SectionLabel>
                        <Toggle
                            label="Спокойный HUD"
                            sublabel="гасит неон-glow · data-intensity=calm"
                            checked={calm}
                            onChange={setCalm}
                        />
                    </div>

                    <Divider />

                    <div className="flex flex-col gap-2">
                        <SectionLabel id="pause-language-label">Язык</SectionLabel>
                        <SegmentedControl
                            label="Язык"
                            labelledBy="pause-language-label"
                            options={LANGUAGE_OPTIONS}
                            value={language}
                            onChange={setLanguage}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <SectionLabel id="pause-difficulty-label">Сложность</SectionLabel>
                        <SegmentedControl
                            label="Сложность"
                            labelledBy="pause-difficulty-label"
                            options={DIFFICULTY_OPTIONS}
                            value={difficulty}
                            onChange={setDifficulty}
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-2.5 px-5 pb-5">
                    <Button onClick={onResume} className="mx-0 w-full">
                        Продолжить
                    </Button>
                    <div className="flex gap-2.5">
                        <Button variant="ghost" onClick={onRestart} className="mx-0 flex-1">
                            Начать заново
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={onExitToMenu}
                            className="mx-0 flex-1 hover:border-danger! hover:text-danger"
                        >
                            Выйти в меню
                        </Button>
                    </div>
                </div>
            </Dialog>
        </ThemeScope>
    );
}
