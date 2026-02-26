import { Wallet, TrendingUp, ArrowDownToLine, CheckCircle2, Clock, XCircle, Receipt } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useEffect, useState } from 'react';

const defaultTransactions = [
  {
    id: 'TX-001',
    type: 'Mint',
    amount: 1000,
    status: 'completed',
    date: '2026-02-25',
    time: '14:32',
    isNew: false,
  },
  {
    id: 'TX-002',
    type: 'Mint',
    amount: 5000,
    status: 'completed',
    date: '2026-02-23',
    time: '10:15',
    isNew: false,
  },
  {
    id: 'TX-003',
    type: 'Redeem',
    amount: 2500,
    status: 'pending',
    date: '2026-02-22',
    time: '16:45',
    isNew: false,
  },
  {
    id: 'TX-004',
    type: 'Mint',
    amount: 3500,
    status: 'completed',
    date: '2026-02-20',
    time: '09:20',
    isNew: false,
  },
  {
    id: 'TX-005',
    type: 'Mint',
    amount: 500,
    status: 'failed',
    date: '2026-02-18',
    time: '11:30',
    isNew: false,
  },
];

export function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [transactions, setTransactions] = useState<any[]>(defaultTransactions);
  const [showReceipt, setShowReceipt] = useState(false);
  const totalBalance = 7000;
  const bsEquivalent = 7000;

  useEffect(() => {
    // Load transactions from localStorage
    const storedTxs = localStorage.getItem('bobcTransactions');
    if (storedTxs) {
      const parsedTxs = JSON.parse(storedTxs);
      setTransactions([...parsedTxs, ...defaultTransactions]);
      
      // Check if there's a new transaction
      const hasNewTransaction = parsedTxs.some((tx: any) => tx.isNew);
      if (hasNewTransaction) {
        setShowReceipt(true);
        // Clear the isNew flag after showing
        const updatedTxs = parsedTxs.map((tx: any) => ({ ...tx, isNew: false }));
        localStorage.setItem('bobcTransactions', JSON.stringify(updatedTxs));
      }
    }
  }, []);

  if (!isConnected) {
    return (
      <div className="min-h-screen py-12 md:py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="bg-card rounded-2xl p-12 border border-border/50 shadow-lg text-center max-w-md">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Wallet className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold text-primary mb-4">Connect Your Wallet</h2>
              <p className="text-muted-foreground mb-6">
                Please connect your wallet to view your dashboard and manage your BOBC holdings.
              </p>
              <button className="px-6 py-3 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors shadow-lg shadow-accent/20">
                Connect Wallet
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 md:py-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-semibold text-primary mb-2">Dashboard</h1>
          <p className="text-lg text-muted-foreground">Manage your BOBC holdings</p>
          {address && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary/5 rounded-lg border border-primary/20">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="font-mono text-sm text-primary">{address.slice(0, 10)}...{address.slice(-8)}</span>
            </div>
          )}
        </div>

        {/* Receipt Banner - Show if there's a new transaction */}
        {showReceipt && transactions.length > 0 && (
          <div className="mb-8 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent rounded-2xl border border-accent/20 p-8 shadow-lg">
            <div className="flex items-start gap-6">
              <div className="w-16 h-16 bg-accent rounded-xl flex items-center justify-center flex-shrink-0">
                <Receipt className="w-8 h-8 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-2xl font-semibold text-primary mb-1">Transaction Successful!</h3>
                    <p className="text-muted-foreground">Your BOBC has been minted and added to your wallet</p>
                  </div>
                  <button
                    onClick={() => setShowReceipt(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ×
                  </button>
                </div>
                
                <div className="bg-card rounded-xl p-6 space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b border-border">
                    <span className="text-sm text-muted-foreground">Transaction ID</span>
                    <span className="font-mono text-sm font-semibold text-foreground">{transactions[0].id}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Amount Minted</span>
                    <span className="text-2xl font-semibold text-accent">+{transactions[0].amount.toLocaleString()} BOBC</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Equivalent</span>
                    <span className="font-semibold text-foreground">Bs {transactions[0].amount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Date & Time</span>
                    <span className="text-sm text-foreground">{transactions[0].date} at {transactions[0].time}</span>
                  </div>
                  <div className="flex justify-between items-center pt-4 border-t border-border">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium bg-accent/10 text-accent border-accent/20">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Completed
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Balance Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="md:col-span-2 bg-gradient-to-br from-primary to-primary/90 dark:from-[#0B1C2D] dark:to-[#0B1C2D]/90 rounded-2xl p-8 text-white shadow-xl">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="text-sm text-white/70 mb-2">Total Balance</div>
                <div className="text-5xl font-semibold mb-2">{totalBalance.toLocaleString()} BOBC</div>
                <div className="text-white/80">≈ Bs {bsEquivalent.toLocaleString()}</div>
              </div>
              <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <Wallet className="w-7 h-7" />
              </div>
            </div>
            
            <div className="flex gap-3">
              <button className="flex-1 py-3 bg-white text-[#0B1C2D] rounded-xl hover:bg-white/90 transition-all font-medium">
                Buy More
              </button>
              <button className="flex-1 py-3 bg-white/10 backdrop-blur-sm text-white rounded-xl hover:bg-white/20 transition-all font-medium flex items-center justify-center gap-2">
                <ArrowDownToLine className="w-4 h-4" />
                Redeem
              </button>
            </div>
          </div>

          <div className="bg-card rounded-2xl p-8 border border-border/50 shadow-sm">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="text-sm text-muted-foreground mb-2">Current Rate</div>
                <div className="text-3xl font-semibold text-primary mb-1">1:1</div>
                <div className="text-sm text-accent flex items-center gap-1">
                  <TrendingUp className="w-4 h-4" />
                  Stable
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              1 BOBC = 1 Bs
            </div>
          </div>
        </div>

        {/* Transaction History */}
        <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-border/50">
            <h2 className="text-2xl font-semibold text-primary">Transaction History</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-background">
                <tr>
                  <th className="px-8 py-4 text-left text-sm text-muted-foreground">Transaction ID</th>
                  <th className="px-8 py-4 text-left text-sm text-muted-foreground">Type</th>
                  <th className="px-8 py-4 text-left text-sm text-muted-foreground">Amount</th>
                  <th className="px-8 py-4 text-left text-sm text-muted-foreground">Status</th>
                  <th className="px-8 py-4 text-left text-sm text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-8 py-5">
                      <span className="font-mono text-sm text-foreground">{tx.id}</span>
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-foreground">{tx.type}</span>
                    </td>
                    <td className="px-8 py-5">
                      <span className="font-semibold text-foreground">
                        {tx.type === 'Redeem' ? '-' : '+'}{tx.amount.toLocaleString()} BOBC
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <StatusBadge status={tx.status} />
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-foreground">{tx.date}</div>
                      <div className="text-sm text-muted-foreground">{tx.time}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    completed: {
      icon: CheckCircle2,
      label: 'Minted',
      className: 'bg-accent/10 text-accent border-accent/20',
    },
    pending: {
      icon: Clock,
      label: 'Pending',
      className: 'bg-yellow-50 text-yellow-600 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800',
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      className: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800',
    },
  };

  const badge = config[status as keyof typeof config] || config.pending;
  const Icon = badge.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${badge.className}`}>
      <Icon className="w-3.5 h-3.5" />
      {badge.label}
    </span>
  );
}