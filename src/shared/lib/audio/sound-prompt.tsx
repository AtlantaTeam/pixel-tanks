'use client';

import { useEffect } from 'react';
import { clsx } from 'clsx';
import { Icon } from '@/shared/ui';
import { markSoundHintSeen, useSoundHintSeen } from './sound-hint';

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Тот же смысл, что несёт визуальная плашка, — словами для скринридера: как
 * включить звук и почему его может не быть на iPhone. Отдельной строкой, а не
 * повтором вёрстки: у визуальной плашки заметка про переключатель показана только
 * на тач-устройствах, а скринридером пользуются и с клавиатуры.
 */
const SOUND_PROMPT_FACT =
    'Звук включается после первого клика, касания или нажатия клавиши. На iPhone проверь бесшумный переключатель сбоку.';

type TSoundPromptProps = {
    /** Доп. классы поверх позиции/оформления по умолчанию (боевой экран
     *  оборачивает в бордер+HUD-подложку — см. `SoundHintToast`). Видимость
     *  (opacity/pointer-events) компонент решает сам через флаг `sound-hint.ts`,
     *  снаружи её не трогать — иначе поле и подложка разъедутся при гашении. */
    className?: string;
};

/**
 * Аркадный промпт «нажми для звука». Браузеры не дают автоплей музыки до
 * первого жеста пользователя (движение мыши/скролл активацией не считаются),
 * поэтому подсказываем: один клик/тап/клавиша включит музыку. Тот же жест
 * разблокирует общий AudioContext через AudioUnlock в layout, а промпт гаснет.
 *
 * Разовый на все экраны (issue #584): переход `/` → `/game` открывает НОВЫЙ
 * AudioContext (снова suspended), поэтому подсказка стоит и на главной, и в бою
 * (`SoundHintToast`) — но флаг «уже видел» (`sound-hint.ts`) общий, чтобы не
 * мозолить каждый бой тому, кто уже кликнул один раз.
 */
export function SoundPrompt({ className }: TSoundPromptProps) {
    const seen = useSoundHintSeen();

    useEffect(() => {
        if (seen) return;
        const controller = new AbortController();
        const dismiss = () => {
            markSoundHintSeen();
            controller.abort();
        };
        for (const type of UNLOCK_EVENTS) {
            window.addEventListener(type, dismiss, { signal: controller.signal });
        }
        return () => controller.abort();
    }, [seen]);

    // Промпт НЕ размонтируется, а гаснет: раньше он возвращал null, строка исчезала
    // из потока, колонка схлопывалась — и вся страница подпрыгивала ровно в момент
    // клика, под курсором/пальцем (#522). Место за ним остаётся навсегда: цена —
    // одна пустая строка, зато раскладка неподвижна.
    return (
        <>
            <p
                aria-hidden
                className={clsx(
                    'font-ui flex flex-col items-center gap-0.5 text-center text-[10px] text-primary/90 transition-opacity duration-300 sm:text-xs motion-reduce:transition-none',
                    seen
                        ? 'pointer-events-none opacity-0'
                        : 'animate-pulse motion-reduce:animate-none',
                    className,
                )}
            >
                <span className="flex items-center gap-1">
                    <Icon name="play" size={12} />
                    нажми — играет музыка
                </span>
                {/* На iPhone WebAudio может молчать из-за аппаратного бесшумного
                    переключателя (не наш баг, кодом не лечится) — не сказать об этом
                    словами значит оставить игрока думать, что приложение сломано.
                    Только тач (`pointer-coarse`): на мыши/трекпаде строка не по адресу. */}
                <span className="hidden text-[9px] text-text-dim normal-case pointer-coarse:block">
                    на iPhone проверь бесшумный переключатель сбоку
                </span>
            </p>
            {/* Тот же факт для скринридера (ревью #585). Плашка выше — `aria-hidden`
                (пульсация, глиф-стиль, строка только для тача — шум для AT), поэтому
                до этого узла заметки про бесшумный переключатель для AT не было ВОВСЕ:
                тот же разъезд «визуальное отдельно, факт отдельно», что у `AimHint`
                и `AimHintAnnouncer`. `sr-only` — вне потока (absolute + clip),
                раскладку и кадр эталона не двигает. Узел уходит вместе с подсказкой:
                факт актуален только пока звук не разблокирован. */}
            {!seen && (
                <span data-testid="sound-prompt-note" className="sr-only">
                    {SOUND_PROMPT_FACT}
                </span>
            )}
        </>
    );
}
