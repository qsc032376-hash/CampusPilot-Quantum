import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TOUR_STEPS } from './tourSteps.ts';
import type { TourStep } from './tourSteps.ts';
import './tour.css';

const STORAGE_KEY = 'campuspilot.tour.v1';

type Rect = { top: number; left: number; width: number; height: number };

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(value: 'done' | 'skipped'): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage can be unavailable; the tour still works for this session */
  }
}

function measure(element: Element | null): Rect | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 && box.height <= 0) return null;
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function resolve(step: TourStep): Element | null {
  if (step.anchor) {
    const primary = document.querySelector(step.anchor);
    if (primary) {
      const box = primary.getBoundingClientRect();
      if (box.width > 0 || box.height > 0) return primary;
    }
  }
  if (step.fallbackAnchor) return document.querySelector(step.fallbackAnchor);
  return null;
}

interface TourProps {
  /** True once a real plan exists; the build step waits for it. */
  hasPlan: boolean;
  /** Successful planner runs; the build step advances only when this grows. */
  planRuns: number;
  /** True when a study block is really selected; the Where step depends on it. */
  hasSelection: boolean;
  /** Increment to replay the tour from the start. */
  replayKey: number;
}

/**
 * First-run product tour.
 *
 * Presentation only: it measures real DOM targets, never clicks them, never
 * submits the task form and never touches plan data. Completing or skipping is
 * stored locally so a refresh does not force the tour again.
 */
export function Tour({ hasPlan, planRuns, hasSelection, replayKey }: TourProps) {
  const [index, setIndex] = useState(-1);
  const [rect, setRect] = useState<Rect | null>(null);
  const [reduced, setReduced] = useState(false);
  const [wipe, setWipe] = useState(0);
  const [celebrate, setCelebrate] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const stepRef = useRef<HTMLDivElement | null>(null);
  const lastChapter = useRef<TourStep['chapter'] | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  /** Planner-run count captured when the Build step became current. */
  const planOnEntry = useRef<number | null>(null);

  const step: TourStep | null = index >= 0 ? TOUR_STEPS[index] ?? null : null;

  // Never start on a machine that already finished or skipped the tour.
  useEffect(() => {
    const stored = readStored();
    if (stored === 'done' || stored === 'skipped') return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
  }, []);

  // Replay from the header button.
  useEffect(() => {
    if (replayKey > 0) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // A replay starts a fresh run: no leftover chapter wipe.
      lastChapter.current = null;
      setWipe(0);
      setCelebrate(0);
      setIndex(0);
    }
  }, [replayKey]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Track the live target so scrolling and layout changes keep the hole aligned.
  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    let frame = 0;
    const sync = () => {
      frame = 0;
      setRect(measure(resolve(step)));
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(sync);
    };
    const element = resolve(step);
    if (element) {
      // Reduced motion removes the easing, never the scrolling itself.
      const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
      element.scrollIntoView({ block: 'center', behavior });
      // On narrow screens the card docks at the bottom, so lift the target clear.
      const box = element.getBoundingClientRect();
      if (window.innerWidth < 560 && box.bottom > window.innerHeight * 0.5) {
        window.scrollBy({ top: box.top - window.innerHeight * 0.18, behavior });
      }
    }
    sync();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const timer = window.setInterval(schedule, 450);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [step, reduced]);

  // Chapter transitions get one wipe; the first step does not.
  useEffect(() => {
    if (!step) return;
    if (lastChapter.current && lastChapter.current !== step.chapter && !reduced) {
      setWipe((value) => value + 1);
    }
    lastChapter.current = step.chapter;
  }, [step, reduced]);

  // Step-scoped flourishes: staggered labels, marker pops, a timeline sweep.
  useEffect(() => {
    if (!step || reduced) return;
    const element = resolve(step);
    if (!element) return;
    const target = element.closest('section, .cp-map-mount') ?? element;
    const className =
      step.effect === 'stagger'
        ? 'cp-tour-stagger'
        : step.effect === 'timeline'
          ? 'cp-tour-timeline'
          : step.effect === 'map'
            ? 'cp-tour-map'
            : null;
    if (!className) return;
    target.classList.add(className);
    const timer = window.setTimeout(() => target.classList.remove(className), 2600);
    return () => {
      window.clearTimeout(timer);
      target.classList.remove(className);
    };
  }, [step, reduced]);

  // Selecting a block changes the Where layout; keep its anchor on screen.
  useEffect(() => {
    if (!step || step.id !== 'block' || !hasSelection) return;
    const element = document.querySelector('[data-tour="where"]');
    if (!element) return;
    const box = element.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      element.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    }
  }, [hasSelection, step, reduced]);

  // Interactive steps hand focus to the real control; the rest focus the card.
  useEffect(() => {
    if (!step) return;
    if (step.waitsForPlan) {
      const buildButton = document.querySelector<HTMLElement>('[data-tour="build"]');
      if (buildButton) {
        buildButton.focus();
        return;
      }
    }
    cardRef.current?.focus();
  }, [step]);

  const finish = useCallback((how: 'done' | 'skipped') => {
    store(how);
    setIndex(-1);
    setRect(null);
    // Hand focus back to whatever opened the tour, so it is never lost.
    const back = returnFocus.current;
    window.requestAnimationFrame(() => {
      if (back && document.contains(back)) back.focus();
    });
  }, []);

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => {
        const next = current + delta;
        if (next < 0) return 0;
        if (next >= TOUR_STEPS.length) {
          finish('done');
          return -1;
        }
        // The build step only advances through a real on-step build, never by
        // Next, ArrowRight or any other forward control.
        if (delta > 0 && TOUR_STEPS[current]?.waitsForPlan) return current;
        return next;
      });
    },
    [finish, hasPlan],
  );

  // Remember the run count when the Build step becomes current, so returning to
  // it (Back, Replay) never counts an older plan as a fresh build.
  useEffect(() => {
    if (step?.waitsForPlan) planOnEntry.current = planRuns;
  }, [step?.id]);

  // Advance only when a build really ran while this step was on screen.
  useEffect(() => {
    if (!step?.waitsForPlan) return;
    if (planOnEntry.current === null) {
      planOnEntry.current = planRuns;
      return;
    }
    if (planRuns > planOnEntry.current) {
      planOnEntry.current = planRuns;
      setCelebrate((value) => value + 1);
      setIndex((current) => current + 1);
    }
  }, [planRuns, step?.id]);

  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      // Never hijack typing: arrows belong to the field while it has focus.
      const target = event.target as HTMLElement | null;
      const editing =
        target instanceof HTMLElement &&
        Boolean(target.closest('input, select, textarea, [contenteditable="true"], [role="textbox"]'));
      if (event.defaultPrevented) return;
      if (editing && event.key !== 'Escape') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        finish('skipped');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(-1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, finish, go]);

  const cardPosition = useMemo(() => {
    if (!rect) return null;
    const width = Math.min(360, window.innerWidth - 24);
    const belowTop = rect.top + rect.height + 14;
    const aboveTop = rect.top - 14 - 190;
    const top = belowTop + 190 < window.innerHeight ? belowTop : Math.max(12, aboveTop);
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    return { top, left, width };
  }, [rect]);

  if (!step) return null;

  const progress = `${index + 1} of ${TOUR_STEPS.length}`;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 560;

  return (
    <div
      className={`cp-tour${reduced ? ' cp-tour--reduced' : ''}`}
      role="dialog"
      aria-labelledby="cp-tour-title"
      aria-describedby="cp-tour-body"
    >
      <div
        className={`cp-tour__mask${rect ? ' cp-tour__mask--holed' : ''}`}
        aria-hidden="true"
        onClick={(event) => event.stopPropagation()}
      />

      {rect ? (
        <div
          key={`${step.id}-spot`}
          className={`cp-tour__spot${step.effect ? ` cp-tour__spot--${step.effect}` : ''}`}
          aria-hidden="true"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : null}

      <div className="cp-tour__layer" aria-hidden="true">
        {step.effect === 'timeline' && rect ? (
          <span
            key={`playhead-${index}`}
            className="cp-tour__playhead"
            style={{ top: rect.top, height: rect.height, left: rect.left }}
          />
        ) : null}
        {celebrate > 0 && step.id === 'results' ? (
          <span key={`ring-${celebrate}`} className="cp-tour__ring" style={{ left: rect ? rect.left + rect.width / 2 : '50%', top: rect ? rect.top : '40%' }} />
        ) : null}
      </div>

      {wipe > 0 ? <span key={`wipe-${wipe}`} className="cp-tour__wipe" aria-hidden="true" /> : null}

      <div
        className={`cp-tour__card${rect ? '' : ' cp-tour__card--center'}`}
        style={
          narrow || !cardPosition
            ? undefined
            : { top: cardPosition.top, left: cardPosition.left, width: cardPosition.width }
        }
        ref={(node) => {
          cardRef.current = node;
          stepRef.current = node;
        }}
        tabIndex={-1}
      >
        <p className="cp-tour__progress">
          {step.chapter === 'build' ? 'Build your first plan' : 'Explore your plan and campus'} · {progress}
        </p>
        <h2 className="cp-tour__title" id="cp-tour-title">
          {step.title}
        </h2>
        <div className="cp-tour__body" id="cp-tour-body">
          {(step.requiresSelection && !hasSelection && step.emptyBody ? step.emptyBody : step.body).map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>{paragraph}</p>
          ))}
        </div>
        {step.hint ? <p className="cp-tour__hint">{step.hint}</p> : null}
        <div className="cp-tour__actions">
          <button type="button" className="cp-tour__skip" onClick={() => finish('skipped')}>
            Skip
          </button>
          <span className="cp-tour__spacer" />
          {index > 0 ? (
            <button type="button" className="cp-tour__back" onClick={() => go(-1)}>
              Back
            </button>
          ) : null}
          {step.waitsForPlan ? null : (
            <button type="button" className="cp-tour__next" onClick={() => go(1)}>
              {index === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
