import { parseSeedParam } from '@/features/game-engine';
import { GamePage } from '@/views/game-page';

type TPageProps = {
    searchParams: Promise<{ seed?: string | string[] }>;
};

export default async function Page({ searchParams }: TPageProps) {
    const { seed } = await searchParams;
    return <GamePage seed={parseSeedParam(seed)} />;
}
