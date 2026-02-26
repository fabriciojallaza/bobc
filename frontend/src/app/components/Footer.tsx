import { Shield, FileText, Mail } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-white border-t border-border/50 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white text-xl font-semibold">B</span>
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-lg text-primary">BOBC</span>
                <span className="text-xs text-muted-foreground -mt-1">Digital Bolivianos. Backed 1:1.</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground max-w-sm">
              A regulated Bolivian stablecoin backed 1:1 by Bolivianos (Bs) held in reserve. Fully transparent, fully compliant.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-primary mb-4">Product</h4>
            <ul className="space-y-2">
              <li>
                <a href="#buy" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Buy BOBC
                </a>
              </li>
              <li>
                <a href="#dashboard" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Dashboard
                </a>
              </li>
              <li>
                <a href="#transparency" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Transparency
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-primary mb-4">Legal</h4>
            <ul className="space-y-2">
              <li>
                <a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" />
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" />
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" />
                  Compliance
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-border/50 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © 2026 BOBC. All rights reserved. Regulated by ASFI Bolivia.
          </p>
          <a
            href="mailto:support@bobc.bo"
            className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
          >
            <Mail className="w-4 h-4" />
            support@bobc.bo
          </a>
        </div>
      </div>
    </footer>
  );
}