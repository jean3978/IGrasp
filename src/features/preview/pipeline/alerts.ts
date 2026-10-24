// GitHub alerts (`> [!NOTE]` …) as plain, sanitizable markup. The icon is added by the React
// `Alert` component, so no SVG has to pass the sanitizer.

import type { ElementContent } from 'hast';
import type { IAlert, IOptions } from 'rehype-github-alerts';

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

const alerts: IAlert[] = ALERT_TYPES.map((keyword) => ({
  keyword: keyword.toUpperCase(),
  icon: '',
  title: keyword.charAt(0).toUpperCase() + keyword.slice(1),
}));

export const alertOptions: IOptions = {
  alerts,
  supportLegacy: false,
  build: (alert, children): ElementContent => {
    const type = alert.keyword.toLowerCase();
    return {
      type: 'element',
      tagName: 'div',
      properties: { className: ['markdown-alert', `markdown-alert-${type}`], dataAlert: type },
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: { className: ['markdown-alert-title'] },
          children: [{ type: 'text', value: alert.title }],
        },
        ...children,
      ],
    };
  },
};
