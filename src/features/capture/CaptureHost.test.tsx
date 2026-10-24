// Region capture wired to the app: the action needs a document or code tab, the overlay covers
// the tab's scroll container, and a selection attaches the lines to the chat without sending.

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { CAPTURE_SOURCE as SOURCE } from '../../test/captureDom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { useCapture } from '../../stores/capture';
import { useDocuments } from '../../stores/documents';
import { useTabs } from '../../stores/tabs';
import { useTextFiles } from '../../stores/textFiles';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { runAction } from '../titlebar/menuActions';
import { box, drag, mountDocument } from '../../test/captureDom';
import { CaptureHost } from './CaptureHost';

function mountCode() {
  const panel = document.createElement('div');
  panel.className = 'tab-content';
  panel.innerHTML =
    '<div class="code-scroll"><div class="code-line" data-index="0">one</div>' +
    '<div class="code-line" data-index="1">two</div><div class="code-line" data-index="2">three</div></div>';
  document.body.append(panel);
  const scroll = panel.querySelector('.code-scroll');
  if (scroll) box(scroll, 0, 400, 0, 600);
  [...panel.querySelectorAll('.code-line')].forEach((el, i) => {
    box(el, i * 20, 20);
  });
  return panel;
}

let mounted: HTMLElement | null = null;

beforeEach(async () => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
  resetAiStores();
  useCapture.setState({ active: false });
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  useDocuments.setState({
    byPath: {
      'README.md': {
        status: 'ready',
        content: SOURCE,
        size: SOURCE.length,
        modifiedMs: 0,
        error: null,
        revision: 1,
      },
    },
  });
  useTextFiles.setState({
    byPath: {
      'src/main.ts': {
        status: 'ready',
        content: 'one\ntwo\nthree',
        size: 13,
        modifiedMs: 0,
        error: null,
        revision: 1,
        truncated: false,
        binary: false,
      } as never,
    },
  });
});

afterEach(async () => {
  mounted?.remove();
  mounted = null;
  useAiConversation.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

describe('ai.capture', () => {
  it('needs a document or code tab', () => {
    render(<CaptureHost />);
    runAction('ai.capture');
    expect(useCapture.getState().active).toBe(false);
    useTabs.getState().openSpecial('settings');
    runAction('ai.capture');
    expect(useCapture.getState().active).toBe(false);
  });

  it('attaches the lines of a dragged region to the chat without sending anything', async () => {
    useTabs.getState().openDocument('README.md');
    mounted = mountDocument();
    render(<CaptureHost />);
    act(() => {
      runAction('ai.capture');
    });
    await waitFor(() => {
      expect(document.querySelector('.capture-overlay')).not.toBeNull();
    });
    // The paragraph, then the list.
    act(() => {
      drag([20, 52], [300, 76]);
    });
    await waitFor(() => {
      expect(useAiPanel.getState().attachment?.capture).toMatchObject({
        sourcePath: 'README.md',
        firstLine: 3,
        lastLine: 3,
        text: 'First paragraph.',
      });
    });
    expect(useAiPanel.getState().draft).toBe('About this region:');
    expect(useAiPanel.getState().open).toBe(true);
    expect(document.querySelector('.capture-overlay')).toBeNull();
    expect(window.__igraspMock?.state.ai.starts).toEqual([]);
  });

  it('maps the rows of a code tab', async () => {
    useTabs.getState().openCode('src/main.ts');
    mounted = mountCode();
    render(<CaptureHost />);
    act(() => {
      runAction('ai.capture');
    });
    await waitFor(() => {
      expect(document.querySelector('.capture-overlay')).not.toBeNull();
    });
    act(() => {
      drag([20, 25], [300, 55]);
    });
    await waitFor(() => {
      expect(useAiPanel.getState().attachment?.capture).toMatchObject({
        sourcePath: 'src/main.ts',
        firstLine: 2,
        lastLine: 3,
        text: 'two\nthree',
      });
    });
  });

  it('leaves a draft the user already wrote alone, and cancels on Escape', async () => {
    useTabs.getState().openDocument('README.md');
    mounted = mountDocument();
    useAiPanel.setState({ draft: 'my own question' });
    render(<CaptureHost />);
    act(() => {
      runAction('ai.capture');
    });
    await waitFor(() => {
      expect(document.querySelector('.capture-overlay')).not.toBeNull();
    });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelector('.capture-overlay')).toBeNull();
    });
    expect(useAiPanel.getState().attachment).toBeNull();
    expect(useAiPanel.getState().draft).toBe('my own question');
  });
});
