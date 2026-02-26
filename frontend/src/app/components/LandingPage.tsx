import { ArrowRight, Shield, Lock, BarChart3 } from 'lucide-react';

interface LandingPageProps {
  onNavigate: (page: 'home' | 'buy' | 'dashboard' | 'transparency') => void;
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-white to-background py-20 md:py-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-full mb-6">
              <Shield className="w-4 h-4" />
              <span className="text-sm font-medium">Regulated & Transparent</span>
            </div>
            
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-semibold text-primary mb-6 tracking-tight">
              The Digital Boliviano
            </h1>
            
            <p className="text-xl md:text-2xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Fully backed. Transparent. On-chain.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <button
                onClick={() => onNavigate('buy')}
                className="px-8 py-4 bg-accent text-white rounded-xl hover:bg-accent/90 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 group"
              >
                Buy BOBC
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={() => onNavigate('transparency')}
                className="px-8 py-4 bg-white text-primary border-2 border-primary/10 rounded-xl hover:border-primary/30 transition-all"
              >
                View Transparency
              </button>
            </div>

            <div className="mt-16 grid grid-cols-3 gap-8 max-w-2xl mx-auto">
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-semibold text-primary mb-2">1:1</div>
                <div className="text-sm text-muted-foreground">Backed Ratio</div>
              </div>
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-semibold text-primary mb-2">100%</div>
                <div className="text-sm text-muted-foreground">Collateralized</div>
              </div>
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-semibold text-primary mb-2">ASFI</div>
                <div className="text-sm text-muted-foreground">Regulated</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-semibold text-primary mb-4">How It Works</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Three simple steps to mint your digital Bolivianos
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="relative">
              <div className="bg-background rounded-2xl p-8 border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 bg-accent/10 text-accent rounded-xl flex items-center justify-center mb-6">
                  <span className="text-2xl font-semibold">1</span>
                </div>
                <h3 className="text-xl font-semibold text-primary mb-3">Deposit Bs</h3>
                <p className="text-muted-foreground">
                  Transfer Bolivianos to our regulated bank account via bank transfer or QR payment.
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="bg-background rounded-2xl p-8 border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 bg-accent/10 text-accent rounded-xl flex items-center justify-center mb-6">
                  <span className="text-2xl font-semibold">2</span>
                </div>
                <h3 className="text-xl font-semibold text-primary mb-3">We Verify Funds</h3>
                <p className="text-muted-foreground">
                  Our system verifies your payment and confirms the deposit in real-time.
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="bg-background rounded-2xl p-8 border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 bg-accent/10 text-accent rounded-xl flex items-center justify-center mb-6">
                  <span className="text-2xl font-semibold">3</span>
                </div>
                <h3 className="text-xl font-semibold text-primary mb-3">BOBC Minted 1:1</h3>
                <p className="text-muted-foreground">
                  BOBC tokens are minted 1:1 and sent directly to your wallet on-chain.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Transparency Section */}
      <section className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-full mb-4">
              <BarChart3 className="w-4 h-4" />
              <span className="text-sm font-medium">Real-Time Data</span>
            </div>
            <h2 className="text-4xl font-semibold text-primary mb-4">Complete Transparency</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Every BOBC token is backed 1:1 by Bolivianos in our reserve
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <div className="bg-white rounded-2xl p-8 border border-border/50 shadow-sm">
              <div className="text-sm text-muted-foreground mb-2">Bank Balance</div>
              <div className="text-3xl font-semibold text-primary mb-1">Bs 12,450,000</div>
              <div className="text-sm text-accent flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-accent"></div>
                Verified
              </div>
            </div>

            <div className="bg-white rounded-2xl p-8 border border-border/50 shadow-sm">
              <div className="text-sm text-muted-foreground mb-2">BOBC Supply</div>
              <div className="text-3xl font-semibold text-primary mb-1">12,450,000</div>
              <div className="text-sm text-accent flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-accent"></div>
                On-chain
              </div>
            </div>

            <div className="bg-white rounded-2xl p-8 border border-border/50 shadow-sm">
              <div className="text-sm text-muted-foreground mb-2">Peg Status</div>
              <div className="text-3xl font-semibold text-accent mb-1">1:1</div>
              <div className="text-sm text-accent flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-accent"></div>
                Verified
              </div>
            </div>
          </div>

          <div className="text-center mt-8">
            <button
              onClick={() => onNavigate('transparency')}
              className="inline-flex items-center gap-2 text-primary hover:text-accent transition-colors"
            >
              View Full Transparency Report
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Shield className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-xl font-semibold text-primary mb-3">Regulated</h3>
              <p className="text-muted-foreground">
                Fully compliant with ASFI regulations and Bolivian financial law.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Lock className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-xl font-semibold text-primary mb-3">Secure</h3>
              <p className="text-muted-foreground">
                Bank-grade security with multi-signature custody and audited smart contracts.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <BarChart3 className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-xl font-semibold text-primary mb-3">Transparent</h3>
              <p className="text-muted-foreground">
                Real-time reserve audits with on-chain proof of all transactions.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}