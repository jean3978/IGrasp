import { ImageOff, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { resolveMedia, usePreview } from '../previewContext';

type ImgProps = ComponentProps<'img'> & { 'data-blocked'?: string };

function Placeholder({ icon, text }: { icon: 'broken' | 'blocked'; text: string }) {
  const Icon = icon === 'blocked' ? ShieldAlert : ImageOff;
  return (
    <span className="media-placeholder" role="img" aria-label={text}>
      <Icon aria-hidden />
      <span>{text}</span>
    </span>
  );
}

export function AssetImage({ src, alt, 'data-blocked': blocked, ...rest }: ImgProps) {
  const ctx = usePreview();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (blocked) {
    return <Placeholder icon="blocked" text={`Blocked insecure (http) image: ${blocked}`} />;
  }
  const media = resolveMedia(ctx, src);
  if (media.kind === 'invalid') return <Placeholder icon="broken" text={media.reason} />;
  if (failedSrc === media.url) {
    return <Placeholder icon="broken" text={`Image not found: ${src ?? ''}`} />;
  }
  return (
    <img
      {...rest}
      src={media.url}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => {
        setFailedSrc(media.url);
      }}
    />
  );
}
