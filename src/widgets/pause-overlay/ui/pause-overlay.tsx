'use client';

import { useState } from 'react';
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
export type TPauseDifficulty = 'Новобранец' | 'Стрелок' | 'Терминатор';

const LANGUAGE_OPTIONS: TSegmentedControlOption<TPauseLanguage>[] = [
    { value: 'RU', label: 'RU' },
    { value: 'EN', label: 'EN' },
];

const DIFFICULTY_OPTIONS: TSegmentedControlOption<TPauseDifficulty>[] = [
    { value: 'Новобранец', label: 'Новобранец' },
    { value: 'Стрелок', label: 'Стрелок' },
    { value: 'Терминатор', label: 'Терминатор' },
];

type TPauseOverlayProps = {
    open: boolean;
    onResume: () => void;
    onRestart: () => void;
    onExitToMenu: () => void;
};

/** design-inventory.dc.html §12 «Экран паузы»: оверлей поверх затемнённой арены.
 *  Настройки звука/HUD/языка/сложности хранятся локально — общего стора звука и
 *  i18n ещё нет (шаги 6 и 10 роадмапа), overlay готов к подключению без правки API. */
export function PauseOverlay({ open, onResume, onRestart, onExitToMenu }: TPauseOverlayProps) {
    const [soundOn, setSoundOn] = useState(true);
    const [musicOn, setMusicOn] = useState(true);
    const [fxOn, setFxOn] = useState(true);
    const [calm, setCalm] = useState(false);
    const [language, setLanguage] = useState<TPauseLanguage>('RU');
    const [difficulty, setDifficulty] = useState<TPauseDifficulty>('Стрелок');

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

                <div className="flex flex-col gap-[18px] px-5 py-5">
                    <div className="flex flex-col gap-3.5">
                        <p className="font-ui text-label text-text-muted uppercase tracking-[0.14em]">
                            Звук
                        </p>
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

                    <div className="h-0.5 bg-border" />

                    <div className="flex flex-col gap-3.5">
                        <p className="font-ui text-label text-text-muted uppercase tracking-[0.14em]">
                            Отображение
                        </p>
                        <Toggle
                            label="Спокойный HUD"
                            sublabel="гасит неон-glow · data-intensity=calm"
                            checked={calm}
                            onChange={setCalm}
                        />
                    </div>

                    <div className="h-0.5 bg-border" />

                    <div className="flex flex-col gap-2">
                        <p className="font-ui text-label text-text-muted uppercase tracking-[0.14em]">
                            Язык
                        </p>
                        <SegmentedControl
                            label="Язык"
                            options={LANGUAGE_OPTIONS}
                            value={language}
                            onChange={setLanguage}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <p className="font-ui text-label text-text-muted uppercase tracking-[0.14em]">
                            Сложность
                        </p>
                        <SegmentedControl
                            label="Сложность"
                            options={DIFFICULTY_OPTIONS}
                            value={difficulty}
                            onChange={setDifficulty}
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-2.5 px-5 pb-5">
                    <Button onClick={onResume} className="w-full">
                        Продолжить
                    </Button>
                    <div className="flex gap-2.5">
                        <Button variant="ghost" onClick={onRestart} className="flex-1">
                            Начать заново
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={onExitToMenu}
                            className="flex-1 hover:border-danger hover:text-danger"
                        >
                            Выйти в меню
                        </Button>
                    </div>
                </div>
            </Dialog>
        </ThemeScope>
    );
}
