import { useState, useEffect, useRef } from 'react';
import { ArrowRight, Copy, CheckCircle2, QrCode, AlertCircle, Loader2, Upload, UserCheck, Bot } from 'lucide-react';
import { useAccount } from 'wagmi';
import { Dialog, DialogContent } from './ui/dialog';
import { api } from '../config/api';

type OrderStatus = 'kyc' | 'form' | 'pending' | 'receipt' | 'awaiting_validation' | 'verified' | 'minting' | 'completed';

interface BuyPageProps {
  onNavigate?: (page: 'home' | 'buy' | 'dashboard' | 'transparency') => void;
}

export function BuyPage({ onNavigate }: BuyPageProps) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState('');
  const [orderStatus, setOrderStatus] = useState<OrderStatus>('form');
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [orderReference, setOrderReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // KYC state
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [kycChecked, setKycChecked] = useState(false);
  const [kycForm, setKycForm] = useState({ nombre: '', ci: '', telefono: '' });
  const [kycTxHash, setKycTxHash] = useState<string | null>(null);

  // Receipt state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);

  // Check KYC status on wallet connect
  useEffect(() => {
    if (!address) {
      setKycChecked(false);
      setKycStatus(null);
      return;
    }
    api.getKycStatus(address).then((data) => {
      if (data.error) {
        setKycStatus(null);
      } else {
        setKycStatus(data.status);
      }
      setKycChecked(true);
    }).catch(() => {
      setKycStatus(null);
      setKycChecked(true);
    });
  }, [address]);

  const needsKyc = kycChecked && (!kycStatus || kycStatus === 'rejected');
  const kycPending = kycStatus === 'pending';
  const kycApproved = kycStatus === 'approved';

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.submitKyc({
        wallet: address,
        nombre: kycForm.nombre,
        ci: kycForm.ci,
        telefono: kycForm.telefono,
      });
      if (result.ok) {
        setKycStatus('pending');
      } else {
        setError(result.error || 'KYC submission failed');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) {
      setError('Please connect your wallet first');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.createOrder({
        wallet: address,
        amount_bs: parseFloat(amount),
      });
      if (result.ok) {
        setOrderId(result.id);
        setOrderReference(result.reference || `ORD-${result.id}`);
        setOrderStatus('pending');
      } else {
        setError(result.error || 'Order creation failed');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setLoading(false);
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orderId) return;

    setReceiptUploading(true);
    setError('');

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        try {
          const result = await api.uploadReceipt(orderId, base64);
          if (result.ok) {
            setOrderStatus('awaiting_validation');
          } else {
            setError(result.error || 'Receipt upload failed');
          }
        } catch {
          setError('Network error uploading receipt.');
        }
        setReceiptUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Failed to read file.');
      setReceiptUploading(false);
    }
  };

  const bobcAmount = amount ? parseFloat(amount) : 0;

  // KYC Form
  if (isConnected && kycChecked && needsKyc) {
    return (
      <div className="min-h-screen py-12 md:py-20">
        <div className="max-w-lg mx-auto px-6">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-semibold text-primary mb-4">Identity Verification</h1>
            <p className="text-muted-foreground">Complete KYC before purchasing BOBC</p>
          </div>
          <div className="bg-card rounded-2xl p-8 border border-border/50 shadow-lg">
            {kycStatus === 'rejected' && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
                Your previous KYC was rejected. Please submit again with correct information.
              </div>
            )}
            <form onSubmit={handleKycSubmit} className="space-y-5">
              <div>
                <label className="block text-sm mb-2 text-foreground">Full Name</label>
                <input
                  type="text"
                  value={kycForm.nombre}
                  onChange={(e) => setKycForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Juan Perez"
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm mb-2 text-foreground">CI (Cedula de Identidad)</label>
                <input
                  type="text"
                  value={kycForm.ci}
                  onChange={(e) => setKycForm(f => ({ ...f, ci: e.target.value }))}
                  placeholder="1234567"
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm mb-2 text-foreground">Phone Number</label>
                <input
                  type="tel"
                  value={kycForm.telefono}
                  onChange={(e) => setKycForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="+591 70000000"
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-accent text-white rounded-xl hover:bg-accent/90 transition-all shadow-lg shadow-accent/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserCheck className="w-5 h-5" />}
                {loading ? 'Submitting...' : 'Submit KYC'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // KYC Pending — poll every 10s, redirect to buy when approved
  if (isConnected && kycPending && !kycApproved) {
    return <KycPendingScreen address={address!} onApproved={(txHash) => {
      setKycStatus('approved');
      setKycTxHash(txHash);
    }} />;
  }

  // KYC just approved — show success then proceed to buy form
  if (isConnected && kycApproved && kycTxHash) {
    return (
      <div className="min-h-screen py-12 md:py-20">
        <div className="max-w-lg mx-auto px-6 text-center">
          <div className="bg-card rounded-2xl p-12 border border-border/50 shadow-lg">
            <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-accent" />
            </div>
            <h2 className="text-2xl font-semibold text-primary mb-2">¡KYC Aprobado!</h2>
            <p className="text-muted-foreground mb-6">Tu identidad fue verificada on-chain por el agente.</p>
            <div className="bg-background rounded-xl p-4 border border-border mb-6 text-left">
              <div className="text-xs text-muted-foreground mb-1">Transaction Hash</div>
              <a
                href={`https://sepolia.etherscan.io/tx/${kycTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-accent hover:underline break-all"
              >
                {kycTxHash}
              </a>
            </div>
            <button
              onClick={() => setKycTxHash(null)}
              className="w-full py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-all font-medium"
            >
              Comprar BOBC →
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          <div className="bg-card rounded-2xl p-8 border border-border/50 shadow-lg">
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
                    disabled={orderStatus !== 'form'}
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

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button
                type="submit"
                disabled={orderStatus !== 'form' || !isConnected || loading}
                className="w-full py-4 bg-accent text-white rounded-xl hover:bg-accent/90 transition-all shadow-lg shadow-accent/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Continue to Payment
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
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
                      <li>- Minimum purchase: Bs 100</li>
                      <li>- Processing time: 5-10 minutes</li>
                      <li>- Make sure your wallet supports BOBC</li>
                      <li>- Keep your transaction reference</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {orderStatus === 'completed' && (
              <div className="bg-card rounded-2xl p-8 border border-border/50 shadow-lg text-center">
                <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-accent" />
                </div>
                <h3 className="text-xl font-semibold text-primary mb-2">¡BOBC emitidos!</h3>
                <p className="text-muted-foreground mb-4">
                  Tu depósito fue verificado y los tokens han sido enviados a tu wallet.
                </p>
                <div className="bg-accent/5 rounded-lg p-4 border border-accent/20 mb-6">
                  <div className="text-2xl font-bold text-accent">{bobcAmount.toLocaleString()} BOBC</div>
                  <div className="text-xs text-muted-foreground mt-1">enviados a tu wallet</div>
                </div>
                <button
                  onClick={() => { setOrderStatus('form'); setAmount(''); setOrderId(null); setOrderReference(''); }}
                  className="w-full py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-all font-medium"
                >
                  Comprar más BOBC
                </button>
              </div>
            )}

            {(orderStatus === 'pending' || orderStatus === 'receipt' || orderStatus === 'awaiting_validation') && (
              <div className="bg-card rounded-2xl p-8 border border-border/50 shadow-lg">
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
                      <span className="font-mono text-sm">{orderReference}</span>
                      <button
                        onClick={() => handleCopy(orderReference)}
                        className="text-accent hover:text-accent/80 transition-colors"
                      >
                        {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Receipt Upload */}
                <div className="mt-6 pt-6 border-t border-border">
                  {orderStatus === 'awaiting_validation' ? (
                    <ReceiptValidationStatus orderId={orderId!} onMinted={() => setOrderStatus('completed')} />
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground mb-3">
                        After making the bank transfer, upload your payment receipt:
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleReceiptUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={receiptUploading}
                        className="w-full py-3 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-accent/20 disabled:opacity-50"
                      >
                        {receiptUploading ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Upload className="w-5 h-5" />
                        )}
                        {receiptUploading ? 'Uploading...' : 'Upload Payment Receipt'}
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-4">
                  <button
                    onClick={() => setShowQR(!showQR)}
                    className="w-full py-3 bg-primary/5 text-primary rounded-lg hover:bg-primary/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <QrCode className="w-5 h-5" />
                    {showQR ? 'Hide QR Code' : 'Show QR Code'}
                  </button>
                </div>

                {showQR && (
                  <div className="mt-4">
                    <div className="bg-background rounded-xl p-8 flex flex-col items-center justify-center border-2 border-dashed border-border">
                      <div className="w-48 h-48 bg-white rounded-lg flex items-center justify-center mb-4">
                        <div className="grid grid-cols-8 gap-1 p-4">
                          {Array.from({ length: 64 }).map((_, i) => (
                            <div
                              key={i}
                              className={`w-3 h-3 ${Math.random() > 0.5 ? 'bg-primary' : 'bg-white'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground text-center">
                        Scan to get payment details
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Receipt Validation Status — polls every 10s, shows agent progress ───────

function ReceiptValidationStatus({ orderId, onMinted }: { orderId: number; onMinted: () => void }) {
  const { address } = useAccount();
  const [status, setStatus] = useState<string>('awaiting_validation');
  const [receiptValidated, setReceiptValidated] = useState(false);
  const [dots, setDots] = useState('');

  useEffect(() => {
    const dotInterval = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 600);
    return () => clearInterval(dotInterval);
  }, []);

  useEffect(() => {
    if (!address) return;
    const poll = async () => {
      try {
        const data = await api.getOrders(address);
        const order = (data.orders || []).find((o: { id: number; status: string; receipt_validated: number }) => o.id === orderId);
        if (!order) return;
        setStatus(order.status);
        setReceiptValidated(!!order.receipt_validated);
        if (order.status === 'minted') {
          onMinted();
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, [address, orderId, onMinted]);

  const isMinted = status === 'minted';
  const isConfirmed = status === 'confirmed';
  const isValidated = receiptValidated || isConfirmed || isMinted;
  const isMinting = isConfirmed;

  const steps = [
    {
      label: '📤 Comprobante recibido — en cola del agente',
      active: false,
      done: true,
    },
    {
      label: isValidated
        ? '✅ Comprobante verificado por el agente'
        : `🔎 Agente analizando comprobante${dots}`,
      active: !isValidated,
      done: isValidated,
    },
    {
      label: isMinted
        ? '✅ Depósito confirmado — Bs registrados'
        : `⏳ Confirmando depósito bancario${isMinting ? dots : ''}`,
      active: isMinting,
      done: isMinted,
    },
    {
      label: isMinted
        ? '🎉 ¡Tokens BOBC emitidos on-chain!'
        : `⛓️ Minteando tokens on-chain${isMinting ? dots : ''}`,
      active: isMinting,
      done: isMinted,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Bot className="w-5 h-5 text-accent animate-pulse" />
        <span className="text-sm font-medium text-primary">Agente procesando{dots}</span>
      </div>
      {steps.map((step, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm transition-all ${
            step.done
              ? 'bg-accent/5 border-accent/20 text-accent'
              : step.active
              ? 'bg-yellow-50 dark:bg-yellow-950 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400'
              : 'bg-muted/20 border-border/30 text-muted-foreground'
          }`}
        >
          {step.active && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />}
          <span>{step.label}</span>
        </div>
      ))}
      <p className="text-xs text-muted-foreground text-center mt-3">Actualizando automáticamente cada 10 segundos</p>
    </div>
  );
}

// ─── KYC Pending Screen — polls every 10s, redirects on approval ──────────────

function KycPendingScreen({ address, onApproved }: { address: string; onApproved: (txHash: string) => void }) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const dotInterval = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 600);
    return () => clearInterval(dotInterval);
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await api.getKycStatus(address);
        if (data.status === 'approved') {
          onApproved(data.tx_hash || '');
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, [address, onApproved]);

  return (
    <div className="min-h-screen py-12 md:py-20">
      <div className="max-w-lg mx-auto px-6 text-center">
        <div className="bg-card rounded-2xl p-12 border border-border/50 shadow-lg">
          <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Bot className="w-10 h-10 text-accent animate-pulse" />
          </div>
          <h2 className="text-2xl font-semibold text-primary mb-3">Verificando identidad{dots}</h2>
          <p className="text-muted-foreground mb-6">
            El agente IA está revisando tu solicitud KYC. Este proceso toma menos de un minuto.
          </p>
          <div className="space-y-3 text-left">
            {[
              { label: '✅ Datos recibidos', done: true },
              { label: '🔎 Agente analizando CI y nombre', done: true },
              { label: '⛓️ Registrando identidad on-chain' + dots, done: false },
            ].map((step, i) => (
              <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${step.done ? 'bg-accent/5 border-accent/20 text-accent' : 'bg-muted/30 border-border/40 text-muted-foreground'}`}>
                <span className="text-sm">{step.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-6">Actualizando automáticamente cada 10 segundos</p>
        </div>
      </div>
    </div>
  );
}
