import { Menubar } from 'radix-ui';
import { Check, ChevronRight, Circle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { THEME_OPTIONS, actions, isTheme, runAction, setTheme } from './menuActions';
import type { ActionId } from './menuActions';

function Item({ id, disabled }: { id: ActionId; disabled?: boolean }) {
  const action = actions[id];
  return (
    <Menubar.Item
      className="menu-item"
      disabled={disabled ?? false}
      onSelect={() => {
        runAction(id);
      }}
    >
      <span className="menu-item-label">{action.label}</span>
      {action.shortcut && <span className="menu-shortcut">{action.shortcut}</span>}
    </Menubar.Item>
  );
}

function CheckItem({ id, checked }: { id: ActionId; checked: boolean }) {
  const action = actions[id];
  return (
    <Menubar.CheckboxItem
      className="menu-item"
      checked={checked}
      onSelect={() => {
        runAction(id);
      }}
    >
      <Menubar.ItemIndicator className="menu-indicator">
        <Check aria-hidden />
      </Menubar.ItemIndicator>
      <span className="menu-item-label">{action.label}</span>
      {action.shortcut && <span className="menu-shortcut">{action.shortcut}</span>}
    </Menubar.CheckboxItem>
  );
}

/** Menu title with its mnemonic letter underlined (Alt+letter opens it). */
function Title({ text, mnemonic }: { text: string; mnemonic: string }) {
  const i = text.toLowerCase().indexOf(mnemonic.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="mnemonic">{text[i]}</span>
      {text.slice(i + 1)}
    </>
  );
}

function Menu({
  value,
  title,
  mnemonic,
  children,
}: {
  value: string;
  title: string;
  mnemonic: string;
  children: ReactNode;
}) {
  return (
    <Menubar.Menu value={value}>
      <Menubar.Trigger className="menubar-trigger" data-mnemonic={mnemonic.toLowerCase()}>
        <Title text={title} mnemonic={mnemonic} />
      </Menubar.Trigger>
      <Menubar.Portal>
        <Menubar.Content className="menu" align="start" sideOffset={2} loop>
          {children}
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

export function MenuBar() {
  const theme = useSettings((s) => s.settings.theme);
  const sidebarVisible = useWorkspace((s) => s.sidebar.visible);

  return (
    <Menubar.Root className="menubar" loop>
      <Menu value="file" title="File" mnemonic="F">
        <Item id="file.exit" />
      </Menu>
      <Menu value="view" title="View" mnemonic="V">
        <CheckItem id="view.toggleSidebar" checked={sidebarVisible} />
        <Menubar.Separator className="menu-separator" />
        <Menubar.Sub>
          <Menubar.SubTrigger className="menu-item">
            <span className="menu-item-label">Theme</span>
            <span className="menu-submenu-arrow">
              <ChevronRight aria-hidden />
            </span>
          </Menubar.SubTrigger>
          <Menubar.Portal>
            <Menubar.SubContent className="menu" sideOffset={4} alignOffset={-5} loop>
              <Menubar.RadioGroup
                value={theme}
                onValueChange={(v) => {
                  if (isTheme(v)) setTheme(v);
                }}
              >
                {THEME_OPTIONS.map((o) => (
                  <Menubar.RadioItem key={o.value} value={o.value} className="menu-item">
                    <Menubar.ItemIndicator className="menu-indicator">
                      <Circle aria-hidden fill="currentColor" size={8} />
                    </Menubar.ItemIndicator>
                    <span className="menu-item-label">{o.label}</span>
                  </Menubar.RadioItem>
                ))}
              </Menubar.RadioGroup>
            </Menubar.SubContent>
          </Menubar.Portal>
        </Menubar.Sub>
        <Menubar.Separator className="menu-separator" />
        <Item id="view.zoomIn" />
        <Item id="view.zoomOut" />
        <Item id="view.zoomReset" />
      </Menu>
    </Menubar.Root>
  );
}
