import { useState } from 'react';
import { ArrowRight, Copy, CheckCircle2, QrCode, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { useAccount } from 'wagmi';
import { Dialog, DialogContent } from './ui/dialog';

type OrderStatus = 'form' | 'pending' | 'verified' | 'minting' | 'completed';

interface BuyPageProps {
  onNavigate?: (page: 'home' | 'buy' | 'dashboard' | 'transparency') => void;
}

export function BuyPage({ onNavigate }: BuyPageProps) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState('');
  const [orderStatus, setOrderStatus] = useState<OrderStatus>('form');
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [transactionId, setTransactionId] = useState('');

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) {
      alert('Please connect your wallet first');
      return;
    }
    const txId = `TX-${Date.now().toString().slice(-6)}`;
    setTransactionId(txId);
    setOrderStatus('pending');
  };

  const handlePaymentConfirmed = () => {
    setOrderStatus('verified');
    setTimeout(() => {
      setOrderStatus('minting');
      setTimeout(() => {
        setOrderStatus('completed');
        // Store transaction in localStorage for dashboard
        const tx = {
          id: transactionId,
          type: 'Mint',
          amount: parseFloat(amount),
          status: 'completed',
          date: new Date().toISOString().split('T')[0],
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          isNew: true,
        };
        const existingTxs = JSON.parse(localStorage.getItem('bobcTransactions') || '[]');
        localStorage.setItem('bobcTransactions', JSON.stringify([tx, ...existingTxs]));
        
        // Navigate to dashboard after 2 seconds
        setTimeout(() => {
          if (onNavigate) {
            onNavigate('dashboard');
          }
        }, 2000);
      }, 2000);
    }, 1500);
  };

  const bobcAmount = amount ? parseFloat(amount) : 0;

  return (
    <div className="min-h-screen py-12 md:py-20">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-semibold text-primary mb-4">Buy BOBC</h1>
          <p className="text-lg text-muted-foreground">
            Get digital Bolivianos backed 1:1 by real currency reserves
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Order Form */}
          <div className="bg-white rounded-2xl p-8 border border-border/50 shadow-lg">
            <h2 className="text-2xl font-semibold text-primary mb-6">Place Order</h2>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm mb-2 text-foreground">Amount in Bs</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">Bs</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-12 pr-4 py-4 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                    min="100"
                    step="0.01"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">Minimum: Bs 100</p>
              </div>

              <div>
                <label className="block text-sm mb-2 text-foreground">Your Wallet Address</label>
                {isConnected && address ? (
                  <div className="w-full px-4 py-4 bg-muted/50 border border-border rounded-xl font-mono text-sm text-muted-foreground flex items-center justify-between">
                    <span>{address.slice(0, 10)}...{address.slice(-8)}</span>
                    <CheckCircle2 className="w-4 h-4 text-accent" />
                  </div>
                ) : (
                  <div className="w-full px-4 py-4 bg-muted/30 border border-border rounded-xl text-sm text-muted-foreground text-center">
                    Please connect your wallet first
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">BOBC will be sent to this address</p>
              </div>

              <div className="bg-background rounded-xl p-6 border border-border">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">You receive</span>
                  <span className="text-2xl font-semibold text-primary">{bobcAmount.toLocaleString()} BOBC</span>
                </div>
                <div className="text-xs text-muted-foreground text-right">Rate: 1 Bs = 1 BOBC</div>
              </div>

              <button
                type="submit"
                disabled={orderStatus !== 'form' || !isConnected}
                className="w-full py-4 bg-accent text-white rounded-xl hover:bg-accent/90 transition-all shadow-lg shadow-accent/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                Continue to Payment
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          </div>

          {/* Payment Instructions */}
          <div className="space-y-6">
            {orderStatus === 'form' && (
              <div className="bg-accent/5 rounded-2xl p-8 border border-accent/20">
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-primary mb-2">Before You Start</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Minimum purchase: Bs 100</li>
                      <li>• Processing time: 5-10 minutes</li>
                      <li>• Make sure your wallet supports BOBC</li>
                      <li>• Keep your transaction reference</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {orderStatus !== 'form' && (
              <div className="bg-white rounded-2xl p-8 border border-border/50 shadow-lg">
                <h3 className="text-xl font-semibold text-primary mb-6">Bank Transfer Instructions</h3>
                
                <div className="space-y-4">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Bank Name</div>
                    <div className="flex items-center justify-between bg-background px-4 py-3 rounded-lg">
                      <span className="font-medium">Banco Nacional de Bolivia</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Account Number</div>
                    <div className="flex items-center justify-between bg-background px-4 py-3 rounded-lg">
                      <span className="font-mono">1234-5678-9012-3456</span>
                      <button
                        onClick={() => handleCopy('1234567890123456')}
                        className="text-accent hover:text-accent/80 transition-colors"
                      >
                        {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Account Holder</div>
                    <div className="flex items-center justify-between bg-background px-4 py-3 rounded-lg">
                      <span className="font-medium">BOBC S.A.</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Amount to Transfer</div>
                    <div className="flex items-center justify-between bg-accent/5 px-4 py-3 rounded-lg border border-accent/20">
                      <span className="text-xl font-semibold text-accent">Bs {bobcAmount.toLocaleString()}</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Reference Code</div>
                    <div className="flex items-center justify-between bg-background px-4 py-3 rounded-lg">
                      <span className="font-mono text-sm">{transactionId}</span>
                      <button
                        onClick={() => handleCopy(transactionId)}
                        className="text-accent hover:text-accent/80 transition-colors"
                      >
                        {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-border">
                  <button 
                    onClick={() => setShowQR(!showQR)}
                    className="w-full py-3 bg-primary/5 text-primary rounded-lg hover:bg-primary/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <QrCode className="w-5 h-5" />
                    {showQR ? 'Hide QR Code' : 'Show QR Code'}
                  </button>
                </div>

                {showQR && (
                  <div className="mt-6 space-y-4">
                    <div className="bg-background rounded-xl p-8 flex flex-col items-center justify-center border-2 border-dashed border-border">
                      <div className="w-48 h-48 bg-white rounded-lg flex items-center justify-center mb-4">
                        {/* Mock QR Code */}
                        <div className="grid grid-cols-8 gap-1 p-4">
                          {Array.from({ length: 64 }).map((_, i) => (
                            <div
                              key={i}
                              className={`w-3 h-3 ${Math.random() > 0.5 ? 'bg-primary' : 'bg-white'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground text-center mb-4">
                        Scan to get payment details
                      </p>
                    </div>
                    
                    {orderStatus === 'pending' && (
                      <button
                        onClick={handlePaymentConfirmed}
                        className="w-full py-3 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        Mark as Paid
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment Status Modal */}
      <Dialog open={orderStatus !== 'form' && orderStatus !== 'pending'} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <PaymentStatusModal status={orderStatus} amount={bobcAmount} transactionId={transactionId} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentStatusModal({ status, amount, transactionId }: { status: OrderStatus; amount: number; transactionId: string }) {
  const statusConfig = {
    verified: {
      icon: CheckCircle2,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      title: 'Payment Verified',
      description: 'Your payment has been confirmed. Minting your BOBC tokens...',
    },
    minting: {
      icon: Loader2,
      color: 'text-accent',
      bg: 'bg-accent/5',
      title: 'Minting BOBC',
      description: 'Your tokens are being minted on-chain. This will take a moment...',
      animate: true,
    },
    completed: {
      icon: CheckCircle2,
      color: 'text-accent',
      bg: 'bg-accent/5',
      title: 'Transaction Complete!',
      description: 'BOBC has been sent to your wallet. Redirecting to dashboard...',
    },
  };

  const config = statusConfig[status as keyof typeof statusConfig];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className="text-center py-6">
      <div className={`w-20 h-20 ${config.bg} rounded-full flex items-center justify-center mx-auto mb-6`}>
        <Icon className={`w-10 h-10 ${config.color} ${config.animate ? 'animate-spin' : ''}`} />
      </div>
      
      <h3 className={`text-2xl font-semibold mb-3 ${config.color}`}>{config.title}</h3>
      <p className="text-muted-foreground mb-6">{config.description}</p>

      <div className="bg-background rounded-xl p-6 mb-6 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Amount</span>
          <span className="font-semibold text-primary">{amount.toLocaleString()} BOBC</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Transaction ID</span>
          <span className="font-mono text-sm text-foreground">{transactionId}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Status</span>
          <span className={`text-sm font-medium ${config.color}`}>
            {status === 'verified' ? 'Verified' : status === 'minting' ? 'Minting' : 'Completed'}
          </span>
        </div>
      </div>

      {status === 'completed' && (
        <div className="flex gap-2 mt-6">
          <div className="h-2 flex-1 rounded-full bg-accent"></div>
          <div className="h-2 flex-1 rounded-full bg-accent"></div>
          <div className="h-2 flex-1 rounded-full bg-accent"></div>
        </div>
      )}
    </div>
  );
}