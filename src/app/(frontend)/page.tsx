import { MainPage } from '@/views/main-page';

// Ссылка «Бой дня» зависит от текущей UTC-даты. Вместо force-dynamic (SSR на
// каждый запрос всей главной) — ISR раз в час: seed сменится в течение часа
// после полуночи, а страница остаётся кэшируемой.
export const revalidate = 3600;

export default function Page() {
    return <MainPage />;
}
