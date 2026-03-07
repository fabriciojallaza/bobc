import { Wallet, TrendingUp, ArrowDownToLine, CheckCircle2, Clock, XCircle, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAccount, useReadContract } from 'wagmi';
import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { api } from '../config/api';
import { BOBC_TOKEN_ADDRESS, BOBC_TOKEN_ABI } from '../config/contracts';

interface WalletProfile {
  isValid: boolean;
  tier: number;
  tierName: string;
  frozen: boolean;
  sanctioned: boolean;
}

const TIER_LIMITS: Record<number, string> = {
  0: '—',
  1: 'Bs 10,000 / tx',
  2: 'Bs 50,000 / tx',
  3: 'Sin límite',
};

export function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [profile, setProfile] = useState<WalletProfile | null>(null);

  // Read BOBC balance from chain
  const { data: balanceData, isLoading: balanceLoading } = useReadContract({
    address: BOBC_TOKEN_ADDRESS,
    abi: BOBC_TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: decimalsData } = useReadContract({
    address: BOBC_TOKEN_ADDRESS,
    abi: BOBC_TOKEN_ABI,
    functionName: 'decimals',
  });

  const decimals = decimalsData ?? 18;
  const balance = balanceData ? Number(formatUnits(balanceData as bigint, decimals as number)) : 0;

  useEffect(() => {
    if (!address) return;
    setOrdersLoading(true);
    api.getOrders(address)
      .then((data) => { if (data.orders) setOrders(data.orders); })
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    api.getKycStatus(address)
      .then((data) => { if (!data.error) setKycStatus(data.status); })
      .catch(() => {});
    api.getProfile(address)
      .then((data: WalletProfile) => setProfile(data))
      .catch(() => {});
  }, [address]);

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
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/5 rounded-lg border border-primary/20">
                <Wallet className="w-4 h-4 text-primary" />
                <span className="font-mono text-sm text-primary">{address.slice(0, 10)}...{address.slice(-8)}</span>
              </div>
              {kycStatus && (
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${
                  kycStatus === 'approved'
                    ? 'bg-accent/10 text-accent border-accent/20'
                    : kycStatus === 'pending'
                    ? 'bg-yellow-50 text-yellow-600 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800'
                    : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800'
                }`}>
                  {kycStatus === 'approved' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  KYC: {kycStatus}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Balance Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="md:col-span-2 bg-gradient-to-br from-primary to-primary/90 dark:from-[#0B1C2D] dark:to-[#0B1C2D]/90 rounded-2xl p-8 text-white shadow-xl">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="text-sm text-white/70 mb-2">Total Balance</div>
                {balanceLoading ? (
                  <Loader2 className="w-8 h-8 animate-spin text-white/70" />
                ) : (
                  <>
                    <div className="text-5xl font-semibold mb-2">{balance.toLocaleString()} BOBC</div>
                    <div className="text-white/80">= Bs {balance.toLocaleString()}</div>
                  </>
                )}
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

        {/* ACE Profile */}
        <div className="bg-card rounded-2xl border border-border/50 shadow-sm p-8 mb-8">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="w-5 h-5 text-accent" />
            <h2 className="text-xl font-semibold text-primary">Perfil ACE</h2>
          </div>
          {!profile ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Consultando chain...
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-background rounded-xl p-4 border border-border/40">
                <div className="text-xs text-muted-foreground mb-1">Estado KYC</div>
                <div className={`font-semibold flex items-center gap-1.5 ${profile.isValid ? 'text-accent' : 'text-muted-foreground'}`}>
                  {profile.isValid ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                  {profile.isValid ? 'Verificado' : 'No verificado'}
                </div>
              </div>
              <div className="bg-background rounded-xl p-4 border border-border/40">
                <div className="text-xs text-muted-foreground mb-1">Tier</div>
                <div className="font-semibold text-primary">
                  {profile.tier === 0 ? '—' : `🪪 ${profile.tierName}`}
                </div>
              </div>
              <div className="bg-background rounded-xl p-4 border border-border/40">
                <div className="text-xs text-muted-foreground mb-1">Límite por tx</div>
                <div className="font-semibold text-primary">{TIER_LIMITS[profile.tier]}</div>
              </div>
              <div className="bg-background rounded-xl p-4 border border-border/40">
                <div className="text-xs text-muted-foreground mb-1">Estado wallet</div>
                <div className={`font-semibold flex items-center gap-1.5 ${profile.frozen || profile.sanctioned ? 'text-red-500' : 'text-accent'}`}>
                  {profile.frozen || profile.sanctioned
                    ? <><ShieldAlert className="w-4 h-4" />{profile.frozen ? 'Congelada' : 'Sancionada'}</>
                    : <><CheckCircle2 className="w-4 h-4" />Activa</>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Order History */}
        <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-border/50">
            <h2 className="text-2xl font-semibold text-primary">Order History</h2>
          </div>

          {ordersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No orders yet. Buy some BOBC to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background">
                  <tr>
                    <th className="px-8 py-4 text-left text-sm text-muted-foreground">Order ID</th>
                    <th className="px-8 py-4 text-left text-sm text-muted-foreground">Reference</th>
                    <th className="px-8 py-4 text-left text-sm text-muted-foreground">Amount</th>
                    <th className="px-8 py-4 text-left text-sm text-muted-foreground">Status</th>
                    <th className="px-8 py-4 text-left text-sm text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {orders.map((order: any) => (
                    <tr key={order.id} className="hover:bg-background/50 transition-colors">
                      <td className="px-8 py-5">
                        <span className="font-mono text-sm text-foreground">#{order.id}</span>
                      </td>
                      <td className="px-8 py-5">
                        <span className="font-mono text-sm text-foreground">{order.reference || '-'}</span>
                      </td>
                      <td className="px-8 py-5">
                        <span className="font-semibold text-foreground">
                          {Number(order.amount_bs).toLocaleString()} BOBC
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="px-8 py-5">
                        <div className="text-foreground text-sm">
                          {order.created_at ? new Date(order.created_at * 1000).toLocaleDateString() : '-'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { icon: any; label: string; className: string }> = {
    confirmed: {
      icon: CheckCircle2,
      label: 'Confirmed',
      className: 'bg-accent/10 text-accent border-accent/20',
    },
    minted: {
      icon: CheckCircle2,
      label: 'Minted',
      className: 'bg-accent/10 text-accent border-accent/20',
    },
    pending: {
      icon: Clock,
      label: 'Pending',
      className: 'bg-yellow-50 text-yellow-600 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800',
    },
    awaiting_validation: {
      icon: Clock,
      label: 'Awaiting Validation',
      className: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800',
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      className: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800',
    },
    rejected: {
      icon: XCircle,
      label: 'Rejected',
      className: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800',
    },
  };

  const badge = configs[status] || configs.pending;
  const Icon = badge.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${badge.className}`}>
      <Icon className="w-3.5 h-3.5" />
      {badge.label}
    </span>
  );
}
