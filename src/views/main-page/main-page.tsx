import Link from 'next/link';
import { DailyChallengeLink } from '@/features/daily-challenge';
import { TankSkinPicker } from '@/features/tank-skin-select';
import { APP_NAME } from '@/shared/config';
import { SceneMusic, SoundPrompt } from '@/shared/lib/audio';
import { buttonClasses } from '@/shared/ui';

export function MainPage() {
    return (
        <main className="relative flex min-h-dvh flex-col items-center justify-center gap-8 overflow-hidden p-6">
            {/* Эпичная тема главной — сгенерирована Lyria 3 из hero-арта */}
            <SceneMusic track="hero" />

            {/* Пульсирующее радиальное свечение в тон арта */}
            <div
                aria-hidden
                className="animate-hero-glow pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,_rgba(0,228,54,0.16),_transparent_65%)] motion-reduce:animate-none"
            />

            {/* Заголовок уже нарисован в hero-арте — дублируем текстом только для скринридеров и SEO */}
            <h1 className="sr-only">{APP_NAME}</h1>

            <div className="border-[length:var(--border-w-thick)] border-border relative w-full max-w-3xl overflow-hidden shadow-[0_0_40px_-8px_rgba(0,228,54,0.35)]">
                {/* Оживлённый hero: клип из Kling (image→video). muted-видео браузеры
                    проигрывают без жеста, poster — первый кадр на время загрузки. */}
                <video
                    aria-hidden
                    autoPlay
                    loop
                    muted
                    playsInline
                    poster="/videos/main-hero-poster.jpg"
                    className="h-auto w-full [image-rendering:pixelated]"
                >
                    <source src="/videos/main-hero.mp4" type="video/mp4" />
                </video>
                {/* CRT-сканлайны с лёгким мерцанием — ретро-аркадный экран */}
                <div
                    aria-hidden
                    className="animate-crt pointer-events-none absolute inset-0 mix-blend-multiply [background-image:repeating-linear-gradient(0deg,_rgba(0,0,0,0.35)_0px,_rgba(0,0,0,0.35)_1px,_transparent_2px,_transparent_3px)] motion-reduce:animate-none"
                />
            </div>

            {/* Управление описывается по ТИПУ УКАЗАТЕЛЯ, а не по ширине экрана: узкое окно
                на десктопе — всё ещё мышь, а планшет в альбомной — всё ещё палец. На тач-
                устройствах прежний текст обещал мышь и колесо, которых там нет вовсе (#521). */}
            <p className="max-w-prose text-center text-text-muted pointer-coarse:hidden">
                Танковая дуэль на Canvas. Управление: мышь — угол, колесо — мощность, клик —
                выстрел. Стрелки — точная настройка угла/мощности, Ctrl+стрелки — смена оружия /
                перемещение танка, Enter или Space — выстрел.
            </p>
            <p className="hidden max-w-prose text-center text-text-muted pointer-coarse:block">
                Танковая дуэль на Canvas. Управление: тяни пальцем по арене — направление и длина
                оттяжки задают угол и силу, отпусти — выстрел. Стрелки на палубе — точная настройка,
                там же смена оружия и перемещение танка.
            </p>

            <TankSkinPicker />

            <div className="flex flex-wrap items-center justify-center gap-2">
                <Link href="/game" className={buttonClasses('primary', 'md')}>
                    Начать игру
                </Link>
                <DailyChallengeLink />
            </div>

            <SoundPrompt />
        </main>
    );
}
