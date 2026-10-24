import { Menubar } from 'radix-ui';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { selectCanGoBack, selectCanGoForward, useHistory } from '../../stores/history';
import { useRecent } from '../../stores/recent';
import { useSettings } from '../../stores/settings';
import { useTree } from '../../stores/tree';
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

function CheckItem({
  id,
  checked,
  disabled,
}: {
  id: ActionId;
  checked: boolean;
  disabled?: boolean;
}) {
  const action = actions[id];
  return (
    <Menubar.CheckboxItem
      className="menu-item"
      checked={checked}
      disabled={disabled ?? false}
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

function SubMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menubar.Sub>
      <Menubar.SubTrigger className="menu-item">
        <span className="menu-item-label">{label}</span>
        <span className="menu-submenu-arrow">
          <ChevronRight aria-hidden />
        </span>
      </Menubar.SubTrigger>
      <Menubar.Portal>
        <Menubar.SubContent className="menu" sideOffset={4} alignOffset={-5} loop>
          {children}
        </Menubar.SubContent>
      </Menubar.Portal>
    </Menubar.Sub>
  );
}

const MENUS = [
  { value: 'file', title: 'File', mnemonic: 'f' },
  { value: 'edit', title: 'Edit', mnemonic: 'e' },
  { value: 'view', title: 'View', mnemonic: 'v' },
  { value: 'help', title: 'Help', mnemonic: 'h' },
] as const;

/** Menu title with its mnemonic letter (underlined while Alt is held). */
function Title({ text, mnemonic }: { text: string; mnemonic: string }) {
  const i = text.toLowerCase().indexOf(mnemonic);
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
  children,
}: {
  value: (typeof MENUS)[number]['value'];
  children: ReactNode;
}) {
  const menu = MENUS.find((m) => m.value === value) ?? MENUS[0];
  return (
    <Menubar.Menu value={value}>
      <Menubar.Trigger
        className="menubar-trigger"
        aria-keyshortcuts={`Alt+${menu.mnemonic.toUpperCase()}`}
      >
        <Title text={menu.title} mnemonic={menu.mnemonic} />
      </Menubar.Trigger>
      <Menubar.Portal>
        <Menubar.Content className="menu" align="start" sideOffset={2} loop>
          {children}
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/**
 * Keyboard access to the menu bar, like native Windows menus: Alt+letter opens a menu, F10 or a
 * lone Alt press focuses the first menu, and mnemonics are underlined while Alt is held.
 */
function useMenuKeyboard(
  rootRef: React.RefObject<HTMLDivElement | null>,
  open: (value: string) => void,
) {
  const [showMnemonics, setShowMnemonics] = useState(false);
  useEffect(() => {
    let altAlone = false;
    const focusFirst = () => {
      rootRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        altAlone = true;
        setShowMnemonics(true);
        return;
      }
      altAlone = false;
      if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        focusFirst();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const menu = MENUS.find((m) => m.mnemonic === e.key.toLowerCase());
        const trigger = menu
          ? rootRef.current?.querySelector<HTMLElement>(
              `[aria-keyshortcuts="Alt+${menu.mnemonic.toUpperCase()}"]`,
            )
          : null;
        if (trigger) {
          e.preventDefault();
          open('');
          // Open it the way a keyboard user would, so focus moves to the first item.
          requestAnimationFrame(() => {
            trigger.focus();
            trigger.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
            );
          });
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      setShowMnemonics(false);
      if (altAlone) {
        e.preventDefault();
        focusFirst();
      }
      altAlone = false;
    };
    const onBlur = () => {
      setShowMnemonics(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [rootRef, open]);
  return showMnemonics;
}

export function MenuBar() {
  const theme = useSettings((s) => s.settings.theme);
  const toastsMuted = useSettings((s) => s.settings.toastsMuted);
  const sidebarVisible = useWorkspace((s) => s.sidebar.visible);
  const rightPanelVisible = useWorkspace((s) => s.rightPanel.visible);
  const canGoBack = useHistory(selectCanGoBack);
  const canGoForward = useHistory(selectCanGoForward);
  const hasRoot = useWorkspace((s) => s.root !== null);
  const openRoot = useWorkspace((s) => s.openRoot);
  const showDotfiles = useTree((s) => s.showDotfiles);
  const showIgnored = useTree((s) => s.showIgnored);
  const recent = useRecent((s) => s.folders);
  const refreshRecent = useRecent((s) => s.refresh);
  const [value, setValue] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const showMnemonics = useMenuKeyboard(rootRef, setValue);

  return (
    <Menubar.Root
      ref={rootRef}
      className="menubar"
      value={value}
      onValueChange={setValue}
      loop
      data-show-mnemonics={showMnemonics ? '' : undefined}
    >
      <Menu value="file">
        <Item id="file.openFolder" />
        <Menubar.Sub
          onOpenChange={(open) => {
            if (open) void refreshRecent();
          }}
        >
          <Menubar.SubTrigger className="menu-item">
            <span className="menu-item-label">Open Recent</span>
            <span className="menu-submenu-arrow">
              <ChevronRight aria-hidden />
            </span>
          </Menubar.SubTrigger>
          <Menubar.Portal>
            <Menubar.SubContent className="menu" sideOffset={4} alignOffset={-5} loop>
              {recent.length === 0 && (
                <Menubar.Item className="menu-item" disabled>
                  <span className="menu-item-label">No recent folders</span>
                </Menubar.Item>
              )}
              {recent.map((f) => (
                <Menubar.Item
                  key={f.path}
                  className="menu-item"
                  disabled={!f.exists}
                  title={f.path}
                  onSelect={() => void openRoot(f.path)}
                >
                  <span className="menu-item-label">{f.name}</span>
                  <span className="menu-shortcut">{f.exists ? '' : 'Not found'}</span>
                </Menubar.Item>
              ))}
              <Menubar.Separator className="menu-separator" />
              <Item id="file.clearRecent" disabled={recent.length === 0} />
            </Menubar.SubContent>
          </Menubar.Portal>
        </Menubar.Sub>
        <Item id="file.closeFolder" disabled={!hasRoot} />
        <Menubar.Separator className="menu-separator" />
        <Item id="file.settings" />
        <Menubar.Separator className="menu-separator" />
        <Item id="file.exit" />
      </Menu>
      <Menu value="edit">
        <Item id="edit.copy" />
        <Item id="edit.selectAll" />
        <Menubar.Separator className="menu-separator" />
        <Item id="go.symbol" disabled={!hasRoot} />
      </Menu>
      <Menu value="view">
        <Item id="go.back" disabled={!canGoBack} />
        <Item id="go.forward" disabled={!canGoForward} />
        <Menubar.Separator className="menu-separator" />
        <CheckItem id="view.toggleSidebar" checked={sidebarVisible} />
        <CheckItem id="view.toggleRightPanel" checked={rightPanelVisible} disabled={!hasRoot} />
        <Item id="view.focusOutline" disabled={!hasRoot} />
        <Item id="claude.chat" disabled={!hasRoot} />
        <Item id="view.focusExplorer" disabled={!hasRoot} />
        <Item id="view.search" disabled={!hasRoot} />
        <Item id="view.recent" disabled={!hasRoot} />
        <Item id="view.broken" disabled={!hasRoot} />
        <Menubar.Separator className="menu-separator" />
        <CheckItem id="view.showDotfiles" checked={showDotfiles} disabled={!hasRoot} />
        <CheckItem id="view.showIgnored" checked={showIgnored} disabled={!hasRoot} />
        <Menubar.Separator className="menu-separator" />
        <CheckItem id="view.muteToasts" checked={toastsMuted} />
        <SubMenu label="Theme">
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
        </SubMenu>
        <Menubar.Separator className="menu-separator" />
        <Item id="view.zoomIn" />
        <Item id="view.zoomOut" />
        <Item id="view.zoomReset" />
      </Menu>
      <Menu value="help">
        <Item id="help.shortcuts" />
        <Menubar.Separator className="menu-separator" />
        <Item id="help.about" />
      </Menu>
    </Menubar.Root>
  );
}
