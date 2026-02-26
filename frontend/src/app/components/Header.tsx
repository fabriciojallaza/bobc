import { Shield, Wallet } from 'lucide-react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

interface HeaderProps {
  currentPage: 'home' | 'buy' | 'dashboard' | 'transparency';
  onNavigate: (page: 'home' | 'buy' | 'dashboard' | 'transparency') => void;
}

export function Header({ currentPage, onNavigate }: HeaderProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const isActive = (path: string) => {
    return currentPage === path;
  };

  const handleConnect = () => {
    const connector = connectors[0]; // Use the first available connector (injected)
    if (connector) {
      connect({ connector });
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <header className="bg-white border-b border-border/50 sticky top-0 z-50 backdrop-blur-sm bg-white/90">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <button onClick={() => onNavigate('home')} className="flex items-center gap-2 group">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center shadow-sm">
              <span className="text-white text-xl font-semibold">B</span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-lg text-primary tracking-tight">BOBC</span>
              <span className="text-xs text-muted-foreground -mt-1">Digital Bolivianos</span>
            </div>
          </button>

          <nav className="hidden md:flex items-center gap-1">
            <button
              onClick={() => onNavigate('buy')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                isActive('buy')
                  ? 'text-primary bg-primary/5'
                  : 'text-muted-foreground hover:text-primary hover:bg-primary/5'
              }`}
            >
              Buy BOBC
            </button>
            <button
              onClick={() => onNavigate('dashboard')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                isActive('dashboard')
                  ? 'text-primary bg-primary/5'
                  : 'text-muted-foreground hover:text-primary hover:bg-primary/5'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => onNavigate('transparency')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                isActive('transparency')
                  ? 'text-primary bg-primary/5'
                  : 'text-muted-foreground hover:text-primary hover:bg-primary/5'
              }`}
            >
              <Shield className="w-4 h-4" />
              Transparency
            </button>
          </nav>

          <div className="flex items-center gap-3">
            {isConnected && address ? (
              <button
                onClick={() => disconnect()}
                className="px-4 py-2.5 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-2 border border-primary/20"
              >
                <Wallet className="w-4 h-4" />
                <span className="font-mono text-sm">{formatAddress(address)}</span>
              </button>
            ) : (
              <button
                onClick={handleConnect}
                className="px-4 py-2.5 bg-white text-primary rounded-lg hover:bg-primary/5 transition-colors flex items-center gap-2 border border-border shadow-sm"
              >
                <Wallet className="w-4 h-4" />
                <span>Connect Wallet</span>
              </button>
            )}
            <button
              onClick={() => onNavigate('buy')}
              className="px-5 py-2.5 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors shadow-sm"
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}