'use client'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

// RFY Tools is a dark-native app (yellow-on-black, per the brand manual), and
// only app/page.tsx is tokenised so far. Following the OS setting therefore
// dropped anyone on a light desktop into a half-built theme. Dark is the
// default and system is off; light is opt-in via the toggle only.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (<NextThemesProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>{children}</NextThemesProvider>)
}
