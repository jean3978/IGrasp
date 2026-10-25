// Keyboard path to the inline review (plan §6.12): "Review in preview" and the status bar item
// move the focus to the first undecided change once the rendered diff is on the page (it renders
// asynchronously), so Tab and A / R work from there.

const MAX_FRAMES = 60;

function target(): HTMLElement | null {
  const review = document.querySelector<HTMLElement>('.tab-content .inline-review');
  if (!review) return null;
  return (
    review.querySelector<HTMLElement>('.diff-group[data-state="pending"]') ??
    review.querySelector<HTMLElement>('[role="group"][tabindex="0"]')
  );
}

export function focusReview(frames = MAX_FRAMES): void {
  const el = target();
  if (el) {
    // The group's scroll margin keeps it below the sticky review bar.
    el.focus();
    return;
  }
  if (frames > 0) {
    requestAnimationFrame(() => {
      focusReview(frames - 1);
    });
  }
}
