import { DropdownMenu } from 'radix-ui';
import { Circle, Contrast, Monitor, Moon, Sun } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { useSettings } from '../../stores/settings';
import type { Theme } from '../../ipc/types';
import { THEME_OPTIONS, isTheme, setTheme } from './menuActions';

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  'high-contrast': Contrast,
  system: Monitor,
};

export function ThemeMenu() {
  const theme = useSettings((s) => s.settings.theme);
  const Icon = ICONS[theme];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="Theme">
          <Icon aria-hidden />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={4} loop>
          <DropdownMenu.Label className="menu-label">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={(v) => {
              if (isTheme(v)) setTheme(v);
            }}
          >
            {THEME_OPTIONS.map((o) => (
              <DropdownMenu.RadioItem key={o.value} value={o.value} className="menu-item">
                <DropdownMenu.ItemIndicator className="menu-indicator">
                  <Circle aria-hidden fill="currentColor" size={8} />
                </DropdownMenu.ItemIndicator>
                <span className="menu-item-label">{o.label}</span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
