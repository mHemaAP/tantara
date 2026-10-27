import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
const inter = Inter({ subsets:['latin'], variable:'--font-inter', display:'swap' });
const playfair = Playfair_Display({ subsets:['latin'], variable:'--font-playfair', display:'swap' });
export const metadata: Metadata = { title:'TANTARA — Legal AI Workspace', description:'AI-powered legal workspace for arbitration law.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body className={`${inter.variable} ${playfair.variable}`}><Providers>{children}</Providers></body></html>; }
