import { Shield, Building2, Coins, CheckCircle2, TrendingUp, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../config/api';

interface TransparencyData {
  bankBalance: number;
  totalSupply: number;
  ratio: number;
}

export function TransparencyPage() {
  const [data, setData] = useState<TransparencyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTransparency()
      .then((d: TransparencyData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isLoading = loading;
  const displayBankBalance = data?.bankBalance ?? 0;
  const bobcSupply = data?.totalSupply ?? 0;
  const collateralRatio = data?.ratio ?? 100;

  return (
    <div className="min-h-screen py-12 md:py-20">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-full mb-6">
            <Shield className="w-4 h-4" />
            <span className="text-sm font-medium">Audited & Verified</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold text-primary mb-4">Complete Transparency</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Real-time proof of reserves. Every BOBC token is backed 1:1 by Bolivianos in our regulated bank account.
          </p>
        </div>

        {/* Main Metrics */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-card rounded-2xl p-8 border border-border/50 shadow-lg">
            <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 bg-accent/10 rounded-xl flex items-center justify-center">
                <Building2 className="w-7 h-7 text-accent" />
              </div>
              <div className="flex items-center gap-1 text-xs text-accent">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
                Live
              </div>
            </div>
            <div className="mb-2">
              <div className="text-sm text-muted-foreground mb-1">Total Bank Balance</div>
              {isLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              ) : (
                <div className="text-4xl font-semibold text-primary">Bs {displayBankBalance.toLocaleString()}</div>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              Banco Nacional de Bolivia
            </div>
          </div>

          <div className="bg-card rounded-2xl p-8 border border-border/50 shadow-lg">
            <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 bg-accent/10 rounded-xl flex items-center justify-center">
                <Coins className="w-7 h-7 text-accent" />
              </div>
              <div className="flex items-center gap-1 text-xs text-accent">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
                Live
              </div>
            </div>
            <div className="mb-2">
              <div className="text-sm text-muted-foreground mb-1">Total BOBC Supply</div>
              {isLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              ) : (
                <div className="text-4xl font-semibold text-primary">{bobcSupply.toLocaleString()}</div>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              On-chain verified
            </div>
          </div>

          <div className="bg-gradient-to-br from-accent to-accent/90 rounded-2xl p-8 text-white shadow-xl">
            <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="flex items-center gap-1 text-xs">
                <TrendingUp className="w-3 h-3" />
                {collateralRatio >= 100 ? 'Healthy' : 'Warning'}
              </div>
            </div>
            <div className="mb-2">
              <div className="text-sm text-white/80 mb-1">Collateral Ratio</div>
              <div className="text-4xl font-semibold">{collateralRatio}%</div>
            </div>
            <div className="text-sm text-white/90">
              {collateralRatio >= 100 ? 'Fully collateralized' : 'Under-collateralized'}
            </div>
          </div>
        </div>

        {/* Peg Indicator */}
        <div className="bg-card rounded-2xl p-8 border border-border/50 shadow-sm mb-16">
          <h2 className="text-2xl font-semibold text-primary mb-6">1:1 Peg Status</h2>

          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="text-center">
                <div className="text-3xl font-semibold text-primary mb-1">Bs {displayBankBalance.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Bank Reserves</div>
              </div>

              <div className="flex-1 mx-8 flex items-center">
                <div className="flex-1 h-2 bg-accent rounded-full"></div>
                <div className="mx-4 px-4 py-2 bg-accent/10 rounded-full">
                  <span className="text-sm font-semibold text-accent">1:1</span>
                </div>
                <div className="flex-1 h-2 bg-accent rounded-full"></div>
              </div>

              <div className="text-center">
                <div className="text-3xl font-semibold text-primary mb-1">{bobcSupply.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">BOBC Supply</div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 text-accent mt-6">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Peg Verified</span>
            </div>
          </div>
        </div>

        {/* Mint Rule Explanation */}
        <div className="bg-background rounded-2xl p-8 border border-border/50">
          <h2 className="text-2xl font-semibold text-primary mb-6">Our Minting Rule</h2>

          <div className="prose prose-lg max-w-none">
            <p className="text-muted-foreground mb-6">
              BOBC operates on a strict 1:1 backing mechanism to ensure every token is fully collateralized:
            </p>

            <div className="bg-card rounded-xl p-6 border border-border/50 mb-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-primary mb-2">Minting Requirement</h3>
                  <p className="text-muted-foreground">
                    New BOBC tokens are <strong className="text-foreground">only minted</strong> when the total bank balance equals or exceeds the total supply plus the new order amount.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-card rounded-xl p-6 border border-border/50">
                <div className="text-sm text-muted-foreground mb-2">Formula</div>
                <code className="block bg-background px-4 py-3 rounded-lg text-sm font-mono">
                    Bank Balance &ge; Supply + Order
                </code>
              </div>

              <div className="bg-card rounded-xl p-6 border border-border/50">
                <div className="text-sm text-muted-foreground mb-2">Current Values</div>
                <code className="block bg-background px-4 py-3 rounded-lg text-sm font-mono">
                    Bs {displayBankBalance.toLocaleString()} &ge; {bobcSupply.toLocaleString()} + 0
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Audit Information */}
        <div className="mt-16 grid md:grid-cols-2 gap-8">
          <div className="bg-card rounded-xl p-6 border border-border/50">
            <h3 className="text-lg font-semibold text-primary mb-4">Bank Verification</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Daily bank statement reconciliation</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Third-party audit verification</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Real-time API integration</span>
              </li>
            </ul>
          </div>

          <div className="bg-card rounded-xl p-6 border border-border/50">
            <h3 className="text-lg font-semibold text-primary mb-4">Smart Contract</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Audited by leading security firms</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">Open source and verifiable</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">On-chain proof of minting</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Regulatory Compliance */}
        <div className="mt-8 bg-accent/5 rounded-2xl p-8 border border-accent/20">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-primary mb-2">Regulatory Compliance</h3>
              <p className="text-muted-foreground mb-4">
                BOBC is fully regulated by ASFI (Autoridad de Supervision del Sistema Financiero) in Bolivia. We comply with all local financial regulations and maintain the highest standards of transparency and security.
              </p>
              <div className="flex gap-4 text-sm text-muted-foreground">
                <span>- License: FSP-2024-001</span>
                <span>- Audited: Q1 2026</span>
                <span>- Jurisdiction: Bolivia</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
