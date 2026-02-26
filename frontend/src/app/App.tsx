import { useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { config } from './config/wagmi';
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { LandingPage } from "./components/LandingPage";
import { BuyPage } from "./components/BuyPage";
import { DashboardPage } from "./components/DashboardPage";
import { TransparencyPage } from "./components/TransparencyPage";

const queryClient = new QueryClient();

export default function App() {
  const [currentPage, setCurrentPage] = useState<'home' | 'buy' | 'dashboard' | 'transparency'>('home');

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <LandingPage onNavigate={setCurrentPage} />;
      case 'buy':
        return <BuyPage onNavigate={setCurrentPage} />;
      case 'dashboard':
        return <DashboardPage />;
      case 'transparency':
        return <TransparencyPage />;
      default:
        return <LandingPage onNavigate={setCurrentPage} />;
    }
  };

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="min-h-screen flex flex-col">
            <Header currentPage={currentPage} onNavigate={setCurrentPage} />
            <main className="flex-1">
              {renderPage()}
            </main>
            <Footer />
          </div>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}