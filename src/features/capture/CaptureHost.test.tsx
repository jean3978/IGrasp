// Selections wired to the app: the region overlay and the text mode need a document or code tab,
// a selection attaches its lines (as text) to the chat without sending, opens the chat next to
// it, and stays highlighted while the chat is open.

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { useCapture } from '../../stores/capture';
import { useDocuments } from '../../stores/documents';
import { useTabs } from '../../stores/tabs';
import { useTextFiles } from '../../stores/textFiles';
import { useWorkspace } from '../../stores/workspace';
import { CAPTURE_SOURCE as SOURCE, box, drag, mountDocument } from '../../test/captureDom';
import { resetAiStores } from '../../test/resetAi';
import { runAction } from '../titlebar/menuActions';
import { CaptureHost, TEXT_DRAFT_PREFIX } from './CaptureHost';

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
  useCapture.setState({ active: false, textMode: false, highlight: null });
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

describe('a region in the chat', () => {
  async function select() {
    useTabs.getState().openDocument('README.md');
    mounted = mountDocument();
    render(<CaptureHost />);
    act(() => {
      runAction('ai.capture');
    });
    await waitFor(() => {
      expect(document.querySelector('.capture-overlay')).not.toBeNull();
    });
    act(() => {
      drag([20, 52], [300, 76]);
    });
    await waitFor(() => {
      expect(useAiPanel.getState().attachment).not.toBeNull();
    });
  }

  it('goes as text, never as an image, and shows in the transcript', async () => {
    await select();
    expect(window.__igraspMock?.state.ai.starts).toEqual([]);
    await useAiConversation.getState().send('Explain this');
    const request = window.__igraspMock?.state.ai.lastRequest;
    expect(request?.images).toEqual([]);
    expect(request?.capture).toMatchObject({ text: 'First paragraph.', firstLine: 3 });
    expect(request?.capture?.selection).toBeUndefined();
    const item = useAiConversation.getState().items.find((i) => i.kind === 'capture');
    expect(item).toMatchObject({ firstLine: 3, text: 'First paragraph.' });
    expect(useAiPanel.getState().attachment).toBeNull();
  });

  it('stays highlighted while the chat is open, after Send too', async () => {
    await select();
    const layer = () => mounted?.querySelector('.document-scroll .ai-highlight-layer');
    await waitFor(() => {
      expect(layer()).not.toBeNull();
    });
    expect(layer()?.querySelector('.ai-highlight-region')).not.toBeNull();
    await act(() => useAiConversation.getState().send('Explain this'));
    expect(layer()).not.toBeNull();
    act(() => {
      useAiPanel.getState().setOpen(false);
    });
    await waitFor(() => {
      expect(layer()).toBeNull();
    });
    expect(useCapture.getState().highlight).toBeNull();
  });

  it('is dropped with its highlight when the file changes', async () => {
    await select();
    act(() => {
      const doc = useDocuments.getState().byPath['README.md'];
      if (!doc) throw new Error('no document');
      useDocuments.setState({
        byPath: { 'README.md': { ...doc, content: `${SOURCE}More.\n`, revision: 2 } },
      });
    });
    await waitFor(() => {
      expect(useCapture.getState().highlight).toBeNull();
    });
    expect(useAiPanel.getState().attachment).toBeNull();
  });
});

describe('the text mode', () => {
  /**
   * Presses the mouse on the element, selects characters `from`..`to` of its text, then releases
   * the mouse on `releaseOn` (the element itself by default).
   */
  function selectText(el: Element, from: number, to: number, releaseOn: Element = el) {
    fireEvent.mouseDown(el, { button: 0 });
    const text = el.firstChild;
    if (!text) throw new Error('no text');
    const range = document.createRange();
    range.setStart(text, from);
    range.setEnd(text, to);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(releaseOn, { button: 0 });
  }

  it('counts a selection released outside the document', async () => {
    useTabs.getState().openDocument('README.md');
    mounted = mountDocument();
    render(<CaptureHost />);
    act(() => {
      runAction('ai.selectText');
    });
    const paragraph = mounted.querySelector('p[data-line="3"]');
    if (!paragraph) throw new Error('no paragraph');
    act(() => {
      selectText(paragraph, 0, 5, document.body);
    });
    await waitFor(() => {
      expect(useAiPanel.getState().attachment?.capture.selection).toBe('First');
    });
  });

  it('ignores a release when the press was not in the document', async () => {
    useTabs.getState().openDocument('README.md');
    mounted = mountDocument();
    render(<CaptureHost />);
    act(() => {
      runAction('ai.selectText');
    });
    const paragraph = mounted.querySelector('p[data-line="3"]');
    if (!paragraph) throw new Error('no paragraph');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);
    fireEvent.mouseDown(document.body, { button: 0 });
    fireEvent.mouseUp(paragraph, { button: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(useAiPanel.getState().attachment).toBeNull();
  });

  it('is a mode of document and code tabs', () => {
    render(<CaptureHost />);
    runAction('ai.selectText');
    expect(useCapture.getState().textMode).toBe(false);
    useTabs.getState().openDocument('README.md');
    runAction('ai.selectText');
    expect(useCapture.getState().textMode).toBe(true);
    runAction('ai.selectText');
    expect(useCapture.getState().textMode).toBe(false);
  });

  it('attaches the highlighted text and its lines when the mouse is released', async () => {
    useTabs.getState().openDocument('README.md');
    mounted = mountDocument();
    render(<CaptureHost />);
    act(() => {
      runAction('ai.selectText');
    });
    expect(document.body.dataset['aiSelect']).toBe('text');
    const paragraph = mounted.querySelector('p[data-line="3"]');
    if (!paragraph) throw new Error('no paragraph');
    act(() => {
      selectText(paragraph, 6, 15);
    });
    await waitFor(() => {
      expect(useAiPanel.getState().attachment?.capture).toEqual({
        sourcePath: 'README.md',
        firstLine: 3,
        lastLine: 3,
        text: 'First paragraph.',
        selection: 'paragraph',
      });
    });
    expect(useAiPanel.getState().open).toBe(true);
    expect(useAiPanel.getState().draft).toBe(TEXT_DRAFT_PREFIX);
    expect(useCapture.getState().highlight).toMatchObject({ kind: 'text' });
    // The mode stays on, and nothing was sent.
    expect(useCapture.getState().textMode).toBe(true);
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(window.__igraspMock?.state.ai.starts).toEqual([]);
  });

  it('is turned off by opening another file', () => {
    useTabs.getState().openDocument('README.md');
    render(<CaptureHost />);
    act(() => {
      runAction('ai.selectText');
    });
    expect(useCapture.getState().textMode).toBe(true);
    act(() => {
      useTabs.getState().openCode('src/main.ts');
    });
    expect(useCapture.getState().textMode).toBe(false);
  });

  it('ignores a click without a selection, and Escape leaves it', async () => {
    useTabs.getState().openDocument('README.md');
    mounted = mountDocument();
    render(<CaptureHost />);
    act(() => {
      runAction('ai.selectText');
    });
    window.getSelection()?.removeAllRanges();
    const paragraph = mounted.querySelector('p');
    if (!paragraph) throw new Error('no paragraph');
    fireEvent.mouseDown(paragraph, { button: 0 });
    fireEvent.mouseUp(paragraph, { button: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(useAiPanel.getState().attachment).toBeNull();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(useCapture.getState().textMode).toBe(false);
    expect(document.body.dataset['aiSelect']).toBeUndefined();
  });
});
