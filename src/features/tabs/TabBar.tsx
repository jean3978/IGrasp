import { clsx } from 'clsx';
import { ContextMenu } from 'radix-ui';
import { FileCode, FileText, Keyboard, Settings, X } from 'lucide-react';
import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useTabs, tabLabel } from '../../stores/tabs';
import type { Tab } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { panelDomId, tabDomId } from './tabIds';
import { HootIcon } from '../hoot/HootIcon';
import './tabs.css';

function copy(text: string) {
  navigator.clipboard.writeText(text).catch((err: unknown) => {
    console.error('Cannot copy to the clipboard', err);
  });
}

function absolutePath(rootPath: string, relPath: string): string {
  const sep = rootPath.includes('\\') ? '\\' : '/';
  return `${rootPath}${sep}${relPath.split('/').join(sep)}`;
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === 'settings') return <Settings aria-hidden />;
  if (tab.kind === 'shortcuts') return <Keyboard aria-hidden />;
  if (tab.kind === 'quiz') return <HootIcon />;
  if (tab.kind === 'code') return <FileCode aria-hidden />;
  return <FileText aria-hidden />;
}

function TabMenu({ tab, children }: { tab: Tab; children: React.ReactNode }) {
  const t = useTabs.getState;
  const rootPath = useWorkspace((s) => s.root?.path ?? '');
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu" loop>
          {!tab.pinned && (
            <ContextMenu.Item
              className="menu-item"
              onSelect={() => {
                t().pin(tab.id);
              }}
            >
              <span className="menu-item-label">Keep Open</span>
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            className="menu-item"
            onSelect={() => {
              t().close(tab.id);
            }}
          >
            <span className="menu-item-label">Close</span>
            <span className="menu-shortcut">Ctrl+W</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="menu-item"
            onSelect={() => {
              t().closeOthers(tab.id);
            }}
          >
            <span className="menu-item-label">Close Others</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="menu-item"
            onSelect={() => {
              t().closeAll();
            }}
          >
            <span className="menu-item-label">Close All</span>
          </ContextMenu.Item>
          {tab.relPath !== null && (
            <>
              <ContextMenu.Separator className="menu-separator" />
              <ContextMenu.Item
                className="menu-item"
                onSelect={() => {
                  if (tab.relPath) copy(tab.relPath);
                }}
              >
                <span className="menu-item-label">Copy Relative Path</span>
              </ContextMenu.Item>
              <ContextMenu.Item
                className="menu-item"
                onSelect={() => {
                  if (tab.relPath) copy(absolutePath(rootPath, tab.relPath));
                }}
              >
                <span className="menu-item-label">Copy Path</span>
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const { activate, close, pin } = useTabs.getState();
  const listRef = useRef<HTMLDivElement>(null);

  if (tabs.length === 0) return null;

  // Manual activation (WAI-ARIA tabs): arrows move focus, Enter/Space activate.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLElement>('[role=tab]') ?? [])];
    const index = buttons.findIndex((b) => b === document.activeElement);
    if (index < 0) return;
    let target: number | null = null;
    if (e.key === 'ArrowRight') target = (index + 1) % buttons.length;
    if (e.key === 'ArrowLeft') target = (index - 1 + buttons.length) % buttons.length;
    if (e.key === 'Home') target = 0;
    if (e.key === 'End') target = buttons.length - 1;
    if (e.key === 'Delete') {
      const tab = tabs[index];
      if (tab) close(tab.id);
      e.preventDefault();
      return;
    }
    if (target !== null) {
      e.preventDefault();
      buttons[target]?.focus();
    }
  };

  return (
    <div
      ref={listRef}
      className="tab-bar"
      role="tablist"
      aria-label="Open files"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const { title, description } = tabLabel(tab, tabs);
        const active = tab.id === activeId;
        return (
          <TabMenu key={tab.id} tab={tab}>
            <div
              className={clsx('tab', {
                'tab-active': active,
                'tab-preview': !tab.pinned,
                'tab-deleted': tab.deleted,
              })}
              title={tab.relPath ?? title}
              onMouseDown={(e) => {
                // Middle click closes, like in browsers and VS Code.
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button === 1) close(tab.id);
              }}
              onDoubleClick={() => {
                pin(tab.id);
              }}
            >
              <button
                type="button"
                role="tab"
                id={tabDomId(tab.id)}
                aria-selected={active}
                aria-controls={panelDomId(tab.id)}
                tabIndex={active ? 0 : -1}
                className="tab-main"
                onClick={() => {
                  activate(tab.id);
                }}
              >
                <TabIcon tab={tab} />
                <span className="tab-title">{title}</span>
                {description && <span className="tab-description">{description}</span>}
                {!tab.pinned && <span className="visually-hidden">(preview)</span>}
                {tab.deleted && <span className="visually-hidden">(deleted)</span>}
              </button>
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${title}`}
                title="Close (Ctrl+W)"
                tabIndex={-1}
                onClick={() => {
                  close(tab.id);
                }}
              >
                <X aria-hidden />
              </button>
            </div>
          </TabMenu>
        );
      })}
    </div>
  );
}
