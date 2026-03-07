import { useState, useEffect } from 'react';
import { WagmiProvider } from 'wagmi';
import { useAccount } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { config } from './config/wagmi';
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { LandingPage } from "./components/LandingPage";
import { BuyPage } from "./components/BuyPage";
import { DashboardPage } from "./components/DashboardPage";
import { TransparencyPage } from "./components/TransparencyPage";
import { api } from './config/api';
import { ShieldAlert, X, ArrowRight } from 'lucide-react';

const queryClient = new QueryClient();

function KycBanner({ onNavigate }: { onNavigate: (p: any) => void }) {
  const { address, isConnected } = useAccount();
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!address) { setKycStatus(null); setDismissed(false); return; }
    api.getKycStatus(address)
      .then((d: any) => { if (!d.error) setKycStatus(d.status); })
      .catch(() => {});
  }, [address]);

  if (!isConnected || dismissed || kycStatus === 'approved' || kycStatus === 'pending') return null;

  return (
    <div className="bg-yellow-50 dark:bg-yellow-950 border-b border-yellow-200 dark:border-yellow-800 px-6 py-3 flex items-center gap-3">
      <ShieldAlert className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
      <span className="text-sm text-yellow-700 dark:text-yellow-300 flex-1">
        Tu wallet no tiene KYC. Sin verificación puedes ver tu balance, pero no comprar BOBC.
      </span>
      <button
        onClick={() => onNavigate('buy')}
        className="text-sm font-medium text-yellow-700 dark:text-yellow-300 flex items-center gap-1 hover:underline"
      >
        Verificarme <ArrowRight className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => setDismissed(true)} className="text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-300">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function AppInner() {
  const [currentPage, setCurrentPage] = useState<'home' | 'buy' | 'dashboard' | 'transparency'>('home');

  const renderPage = () => {
    switch (currentPage) {
      case 'home': return <LandingPage onNavigate={setCurrentPage} />;
      case 'buy': return <BuyPage onNavigate={setCurrentPage} />;
      case 'dashboard': return <DashboardPage />;
      case 'transparency': return <TransparencyPage />;
      default: return <LandingPage onNavigate={setCurrentPage} />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header currentPage={currentPage} onNavigate={setCurrentPage} />
      <KycBanner onNavigate={setCurrentPage} />
      <main className="flex-1">{renderPage()}</main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AppInner />
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}