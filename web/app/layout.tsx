import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Questly — Make progress a ritual', description:'Build better habits, one quest at a time.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
