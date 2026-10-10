import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { currentThemeMode, setThemeMode } from '@/branding/applyTheme';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const [mode, setMode] = useState(currentThemeMode);
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        setThemeMode(next);
        setMode(next);
      }}
    >
      {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
