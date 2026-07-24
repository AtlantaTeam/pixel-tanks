import Link from 'next/link';
import { decodeReplay } from '@/entities/replays';
import { ReplayCanvas } from '@/features/game-engine';
import { SceneMusic } from '@/shared/lib/audio';
import { buttonClasses } from '@/shared/ui';
import { ReplayHud } from './replay-hud';

type TReplayPageProps = {
    code: string;
};

/**
 * Страница просмотра реплея: декодирует код из URL на сервере и отдаёт бой
 * движку на воспроизведение. Публичная — работает на чистом браузере без
 * регистрации. Невалидный код (мусор, обрезанная ссылка, чужая версия
 * формата) — честный error-state со ссылкой сыграть самому.
 */
export function ReplayPage({ code }: TReplayPageProps) {
    const replay = decodeReplay(code);

    if (!replay) {
        return (
            <main className="safe-area-inset flex h-dvh flex-col items-center justify-center gap-6 overflow-hidden p-4 text-center">
                <h1 className="font-display text-h2 text-primary uppercase">Реплей не найден</h1>
                <p className="max-w-md text-body text-text-muted">
                    Ссылка повреждена или записана несовместимой версией игры — воспроизвести этот
                    бой не получилось.
                </p>
                <Link href="/game" className={buttonClasses('primary', 'md')}>
                    Сыграть самому
                </Link>
            </main>
        );
    }

    return (
        <main className="safe-area-inset flex h-dvh flex-col overflow-hidden">
            <SceneMusic track="battle" />
            <div className="relative flex-1 overflow-hidden">
                <ReplayCanvas replay={replay} />
            </div>
            <div data-testid="replay-hud" className="border-t border-border bg-panel">
                <ReplayHud />
            </div>
        </main>
    );
}
