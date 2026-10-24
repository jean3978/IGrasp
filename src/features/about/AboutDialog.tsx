import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { backend } from '../../ipc/client';
import type { AppInfo } from '../../ipc/types';
import { useUi } from '../../stores/ui';
import { AppLogo } from '../splash/AppLogo';
import './about.css';

const REPOSITORY = 'https://github.com/jean3978/IGrasp';

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void backend.openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

export function AboutDialog() {
  const open = useUi((s) => s.aboutOpen);
  const setOpen = useUi((s) => s.setAboutOpen);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (open && !info) void backend.getAppInfo().then(setInfo);
  }, [open, info]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog about" aria-describedby="about-description">
          <Dialog.Close className="dialog-close" aria-label="Close">
            <X aria-hidden />
          </Dialog.Close>
          <AppLogo className="about-logo" />
          <Dialog.Title className="about-title">IGrasp</Dialog.Title>
          <p id="about-description" className="about-tagline">
            Read the markdown documentation of a project and grasp what AI agents are writing.
          </p>
          <p className="about-ai">This app is AI-generated and conscientiously prompted.</p>
          {info && (
            <dl className="about-info">
              <dt>Version</dt>
              <dd>{info.version}</dd>
              <dt>Tauri</dt>
              <dd>{info.tauriVersion}</dd>
              <dt>System</dt>
              <dd>{info.os}</dd>
              <dt>App data</dt>
              <dd className="about-path">{info.appDataDir}</dd>
              <dt>Logs</dt>
              <dd className="about-path">{info.logDir}</dd>
            </dl>
          )}
          <p className="about-links">
            <ExternalLink href={REPOSITORY}>Source code</ExternalLink>
            {' · '}
            <ExternalLink href={`${REPOSITORY}/blob/main/LICENSE`}>MIT License</ExternalLink>
            {' · '}
            <ExternalLink href={`${REPOSITORY}/issues`}>Report an issue</ExternalLink>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
