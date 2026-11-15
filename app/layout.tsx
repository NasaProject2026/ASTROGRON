import type { Metadata } from 'next';
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import '@/styles/globals.css';
import { AstragronProvider } from '@/hooks/use-astragron-store';
import { TopNavigationBar, SiteFooter } from '@/components/navigation/app-chrome';
import { WebVitalsReporter } from '@/components/telemetry/web-vitals-reporter';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--font-display',
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'ASTRAGRON — Orbital Intelligence for Agricultural Research & Decision Support',
  description:
    'Explore Earth observations, evaluate multi-year agricultural research scenarios, and inspect the evidence and uncertainty behind every result.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${spaceGrotesk.variable} ${plusJakartaSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-[#07111F] text-[#F1F7FD] antialiased">
        <AstragronProvider>
          <WebVitalsReporter />
          <TopNavigationBar />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </AstragronProvider>
      </body>
    </html>
  );
}
