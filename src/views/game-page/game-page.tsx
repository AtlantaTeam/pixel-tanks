import Link from 'next/link';
import { GameCanvas } from '@/features/game-engine';
import { SceneMusic } from '@/shared/lib/audio';
import { Icon } from '@/shared/ui';
import { GameControls } from '@/widgets/game-controls';
import { GameOverDialog } from '@/widgets/game-over-dialog';

type TGamePageProps = {
    seed?: string;
};

export function GamePage({ seed }: TGamePageProps = {}) {
    return (
        <main className="safe-area-inset flex h-dvh flex-col overflow-hidden">
            <SceneMusic track="battle" />
            <div className="relative flex-1 overflow-hidden">
                <GameCanvas seed={seed} />
            </div>
            <div data-testid="game-hud" className="border-t border-border bg-panel">
                <GameControls />
            </div>
            <GameOverDialog seed={seed} />
            <Link
                href="/design-system"
                aria-label="Витрина компонентов"
                style={{
                    top: 'max(1rem, env(safe-area-inset-top))',
                    right: 'max(1rem, env(safe-area-inset-right))',
                }}
                className="fixed z-40 flex min-h-11 min-w-11 items-center justify-center rounded-sm bg-panel-raised text-text-muted opacity-50 transition-all hover:text-primary hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary"
            >
                <Icon name="settings" size={16} />
            </Link>
        </main>
    );
}
