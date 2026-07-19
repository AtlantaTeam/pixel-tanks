import Link from 'next/link';
import { buttonClasses } from '@/shared/ui';
import { getDailySeed } from '../../lib/daily-seed';

export function DailyChallengeLink() {
    const seed = getDailySeed();
    return (
        <Link href={`/game?seed=${seed}`} className={buttonClasses('ghost', 'md')}>
            Бой дня
        </Link>
    );
}
