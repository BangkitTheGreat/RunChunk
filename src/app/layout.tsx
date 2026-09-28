import type {Metadata} from 'next';
import {Plus_Jakarta_Sans, JetBrains_Mono} from 'next/font/google';
import {NextIntlClientProvider} from 'next-intl';
import {getLocale, getMessages} from 'next-intl/server';
import {cookies} from 'next/headers';
import '@xyflow/react/dist/style.css';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({variable: '--font-jakarta', subsets: ['latin']});
const mono = JetBrains_Mono({variable: '--font-jetbrains', subsets: ['latin']});
export const metadata: Metadata = {title: 'RunChunk', description: 'Visual workflow automation'};
export default async function RootLayout({children}: {children: React.ReactNode}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = (await cookies()).get('theme')?.value === 'light' ? 'light' : 'dark';
  return <html lang={locale} data-theme={theme} className={`${jakarta.variable} ${mono.variable}`}><body><NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider></body></html>;
}
