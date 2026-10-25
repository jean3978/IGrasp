// Building blocks of the settings page.

import { Switch, ToggleGroup } from 'radix-ui';
import { useId } from 'react';
import type { ReactNode } from 'react';

export function Field({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  const descId = useId();
  return (
    <div className="settings-field">
      <div className="settings-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {description && (
          <p id={descId} className="settings-description">
            {description}
          </p>
        )}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className="segmented"
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        const option = options.find((o) => o.value === v);
        if (option) onChange(option.value);
      }}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className="segmented-item">
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Toggle({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Switch.Root id={id} className="switch" checked={checked} onCheckedChange={onChange}>
      <Switch.Thumb className="switch-thumb" />
    </Switch.Root>
  );
}
