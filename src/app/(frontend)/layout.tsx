import type { Metadata, Viewport } from 'next';
import { QueryProvider } from '@/shared/api';
import { APP_NAME } from '@/shared/config';
import { AudioUnlock } from '@/shared/lib/audio';
import '../globals.css';

export const metadata: Metadata = {
    title: `${APP_NAME} — танковая дуэль на Canvas`,
    description: `Учебная игра ${APP_NAME}. Стреляй, считай угол, ветер и силу — побеждай.`,
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
};

export default function FrontendLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ru" suppressHydrationWarning>
            {/* Preload основных woff2 — вернули автоматику next/font, потерянную при
                самостоятельном хостинге шрифтов: без него браузер узнаёт о шрифтах только
                после загрузки и парса CSS, старт загрузки позже и дольше FOUT при
                font-display: swap. Press Start 2P — весь игровой HUD и заголовки,
                Montserrat — основной текст; оба сабсета (latin + cyrillic) нужны
                над сгибом на русской странице. */}
            <head>
                <link
                    rel="preload"
                    href="/fonts/press-start-2p-cyrillic.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
                <link
                    rel="preload"
                    href="/fonts/press-start-2p-latin.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
                <link
                    rel="preload"
                    href="/fonts/montserrat-cyrillic.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
                <link
                    rel="preload"
                    href="/fonts/montserrat-latin.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
            </head>
            <body className="font-sans antialiased">
                <QueryProvider>
                    <AudioUnlock />
                    {children}
                </QueryProvider>
            </body>
        </html>
    );
}
