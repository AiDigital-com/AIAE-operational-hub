import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AppShell } from "../features/layout/app-shell/app-shell";
import { ThemeProvider } from "../shared/style/theme";
import { LogoIcon } from "../shared/ui/icons/icons";
import { ToastProvider } from "../shared/ui/toast/toast";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SignedOut>
          <main className="login-page">
            <div className="login-shell">
              <section className="login-brand" aria-hidden="false">
                <div className="login-brand__logo" aria-hidden="true">
                  <LogoIcon fill="var(--color-accent-contrast)" stroke="var(--color-accent)" />
                </div>
                <p className="login-brand__eyebrow">AI Digital</p>
                <h1>Operational Hub</h1>
                <p>Sign in to manage marketing campaign data, users, and platform operations.</p>
              </section>
              <section className="login-panel">
                <h2 className="login-panel__title">Log in</h2>
                <SignIn routing="hash" signUpUrl="/" />
              </section>
            </div>
          </main>
        </SignedOut>
        <SignedIn>
          <ToastProvider>
            <BrowserRouter>
              <AppShell />
            </BrowserRouter>
          </ToastProvider>
        </SignedIn>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
