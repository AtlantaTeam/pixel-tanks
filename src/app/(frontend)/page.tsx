import { MainPage } from '@/views/main-page';

// Ссылка «Бой дня» зависит от текущей UTC-даты — без force-dynamic Next
// закэширует её один раз при сборке, и seed никогда не сменится в полночь.
export const dynamic = 'force-dynamic';

export default function Page() {
    return <MainPage />;
}
