import Link from 'next/link';
import { APP_NAME } from '@/shared/config';
import { buttonClasses } from '@/shared/ui';

export function MainPage() {
    return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
            <h1 className="text-center font-pixel text-2xl text-primary sm:text-4xl">{APP_NAME}</h1>
            <p className="max-w-prose text-center text-muted">
                Танковая дуэль на Canvas. Управление: мышь — угол, колесо — мощность, клик —
                выстрел. Стрелки — точная настройка угла/мощности, Ctrl+стрелки — смена оружия /
                перемещение танка, Enter или Space — выстрел.
            </p>
            <Link href="/game" className={buttonClasses('primary', 'md')}>
                Начать игру
            </Link>
        </main>
    );
}
