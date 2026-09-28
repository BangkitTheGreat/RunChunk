import {NextIntlClientProvider} from 'next-intl';
import {getMessages} from 'next-intl/server';
import RunChunk from '@/components/run-chunk';

export default async function Home(){
  const messages=await getMessages();
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return <main className="setup-screen"><div className="setup-card"><span className="brand-mark"><span>R</span></span><p className="eyebrow">RUNChunk · SETUP REQUIRED</p><h1>Connect your workspace</h1><p>RunChunk needs Supabase Auth and database credentials before it can load or save workflows. No demo data or fake runs are shown.</p><div className="setup-step"><span>01</span><div><strong>Set environment variables</strong><code>NEXT_PUBLIC_SUPABASE_URL</code><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></div></div><div className="setup-step"><span>02</span><div><strong>Apply database migration</strong><p>Run the SQL migration in <code>supabase/migrations</code> in your Supabase project.</p></div></div><p className="setup-foot">Restart development server after configuring environment.</p></div></main>;
  return <NextIntlClientProvider messages={messages}><RunChunk/></NextIntlClientProvider>;
}
