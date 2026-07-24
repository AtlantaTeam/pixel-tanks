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
                font-display: swap. Pixelify Sans — заголовки/лого/крупные счётчики,
                JetBrains Mono — кнопки/метки/тело/HUD-числа (docs/design-system-theming/tokens.md);
                оба сабсета (latin + cyrillic)
                нужны над сгибом на русской странице. */}
            <head>
                <link
                    rel="preload"
                    href="/fonts/pixelify-sans-cyrillic.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
                <link
                    rel="preload"
                    href="/fonts/pixelify-sans-latin.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
                <link
                    rel="preload"
                    href="/fonts/jetbrains-mono-cyrillic.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
                <link
                    rel="preload"
                    href="/fonts/jetbrains-mono-latin.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
            </head>
            <body className="font-ui antialiased">
                <QueryProvider>
                    <AudioUnlock />
                    {children}
                </QueryProvider>
            </body>
        </html>
    );
}
