import { ExternalLink, Film } from 'lucide-react';
import { Children, createContext, isValidElement, useContext, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { backend } from '../../../ipc/client';
import { platform } from '../../../lib/platform';
import { resolveMedia, usePreview } from '../previewContext';

/** README section listing the GStreamer packages needed for video on Linux. */
export const LINUX_VIDEO_HELP_URL = 'https://github.com/jean3978/IGrasp#video-on-linux';

const VideoFailure = createContext<() => void>(() => undefined);

type Blockable = { 'data-blocked'?: string };

function VideoFallback({ relPath, label }: { relPath: string | null; label: string }) {
  return (
    <div className="video-fallback" role="group" aria-label="Video unavailable">
      <Film className="video-fallback-icon" aria-hidden />
      <div className="video-fallback-body">
        <strong>{label}</strong>
        <span>This video cannot be played inside IGrasp.</span>
        {platform === 'linux' && (
          <span>
            Video playback on Linux needs the GStreamer plugins.{' '}
            <a
              href={LINUX_VIDEO_HELP_URL}
              onClick={(e) => {
                e.preventDefault();
                void backend.openUrl(LINUX_VIDEO_HELP_URL);
              }}
            >
              See which packages to install
            </a>
            .
          </span>
        )}
      </div>
      {relPath !== null && (
        <button
          type="button"
          className="button"
          onClick={() => {
            backend.openExternal(relPath).catch((err: unknown) => {
              console.error('Cannot open the video', err);
            });
          }}
        >
          <ExternalLink aria-hidden />
          Open externally
        </button>
      )}
    </div>
  );
}

/** `<source>` inside a video: resolved like the video's own `src`. */
export function AssetSource({
  src,
  'data-blocked': blocked,
  ...rest
}: ComponentProps<'source'> & Blockable) {
  const ctx = usePreview();
  const fail = useContext(VideoFailure);
  if (blocked) return null;
  const media = resolveMedia(ctx, src);
  if (media.kind === 'invalid') return null;
  return <source {...rest} src={media.url} onError={fail} />;
}

function firstSourcePath(children: ReactNode): string | undefined {
  for (const child of Children.toArray(children)) {
    if (isValidElement<{ src?: string }>(child) && typeof child.props.src === 'string') {
      return child.props.src;
    }
  }
  return undefined;
}

export function AssetVideo({
  src,
  children,
  'data-blocked': blocked,
  ...rest
}: ComponentProps<'video'> & Blockable) {
  const ctx = usePreview();
  const [failed, setFailed] = useState(false);
  const declared = src ?? firstSourcePath(children);
  const media = resolveMedia(ctx, declared);
  const relPath = media.kind === 'url' ? media.relPath : null;
  const label = declared ? (declared.split('/').pop() ?? declared) : 'Video';

  if (blocked)
    return <VideoFallback relPath={null} label={`Blocked insecure (http) video: ${blocked}`} />;
  if (failed || (src !== undefined && media.kind === 'invalid')) {
    return <VideoFallback relPath={relPath} label={label} />;
  }
  return (
    <VideoFailure.Provider
      value={() => {
        setFailed(true);
      }}
    >
      <video
        {...rest}
        src={src !== undefined && media.kind === 'url' ? media.url : undefined}
        controls
        preload="metadata"
        onError={() => {
          setFailed(true);
        }}
      >
        {children}
      </video>
    </VideoFailure.Provider>
  );
}
