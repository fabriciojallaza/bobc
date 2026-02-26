import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycle = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const icon =
    theme === 'dark' ? <Moon className="w-4 h-4" /> :
    theme === 'light' ? <Sun className="w-4 h-4" /> :
    <Monitor className="w-4 h-4" />;

  return (
    <button
      onClick={cycle}
      className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
      aria-label="Toggle theme"
    >
      {icon}
    </button>
  );
}
