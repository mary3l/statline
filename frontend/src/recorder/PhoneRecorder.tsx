import { periodLabel } from '@engine/fiba';
import { inPenalty, timeoutsLeft } from '@engine/live';
import { forcedSub, onSwipe, onText, prompt, type Buzz, type FlowContext, type FlowResult, type Question } from '@engine/phoneFlow';
import { Box, Dialog } from '@mui/material';
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Side } from '../api/types';
import { candidates, lastMissSide, sideWords } from './commandSupport';
import { describe } from './PlayByPlay';
import { fmtClock } from './Scoreboard';
import { readJson, writeJson } from './storage';
import { C, display, SIDE_COLOR } from './theme';
import { Btn, Kicker } from './ui';
import { shortName, type Recorder } from './useRecorder';

const PREFS_KEY = 'statline:phone-prefs';
const BUZZ: Record<Buzz, number[]> = {
  saved: [40],
  question: [40, 90, 40],
  error: [450],
  undo: [30, 60, 30, 60, 30],
};

type Chip = { label: string; text?: string; swipe?: 'right' | 'left'; color?: string; jersey?: boolean };

const PLAY_CHIPS = ['three made', 'three missed', 'two made', 'two missed', 'free throw made', 'free throw missed', 'rebound', 'assist', 'steal', 'block', 'turnover', 'foul'];

/** One-word team name for speech ("Mavericks"). */
const spokenTeam = (name: string) => name.split(/\s+/).slice(-1)[0] ?? name;

export function PhoneRecorder({ rec }: { rec: Recorder }) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [said, setSaid] = useState('Ready. Type the jersey, then the play.');
  const [lastBuzz, setLastBuzz] = useState<Buzz>('saved');
  const [text, setText] = useState('');
  const [help, setHelp] = useState(false);
  const [prefs, setPrefs] = useState(() => readJson<{ speak: boolean; vibrate: boolean }>(PREFS_KEY) ?? { speak: true, vibrate: true });
  const inputRef = useRef<HTMLInputElement>(null);

  const ctx: FlowContext = useMemo(
    () => ({
      players: candidates(rec).map((p) => ({ ...p, name: shortName(p), fouls: rec.live.fouls.get(p.playerId) ?? 0 })),
      teamName: { home: spokenTeam(rec.game.home.name), away: spokenTeam(rec.game.away.name) },
      penalty: { home: inPenalty(rec.live, 'home', rec.period), away: inPenalty(rec.live, 'away', rec.period) },
      timeoutsLeft: { home: timeoutsLeft(rec.live, 'home', rec.period), away: timeoutsLeft(rec.live, 'away', rec.period) },
      lastMissSide: lastMissSide(rec.events),
      options: sideWords(rec),
    }),
    [rec],
  );

  const speak = (line: string) => {
    if (!prefs.speak || !line || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.lang = 'en-US';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  };
  const buzz = (b: Buzz) => {
    setLastBuzz(b);
    if (prefs.vibrate && typeof navigator.vibrate === 'function') navigator.vibrate(BUZZ[b]);
  };
  const announce = (line: string, b: Buzz) => {
    setSaid(line);
    speak(line);
    buzz(b);
  };

  const readout = (q: Question | null = question) => {
    const s = rec.box.score;
    const line = `${ctx.teamName.home} ${s.home}, ${ctx.teamName.away} ${s.away}. ${periodLabel(rec.period).replace('Q', 'Quarter ').replace('OT', 'Overtime ')}, ${Math.floor(rec.clock / 60)} minutes ${rec.clock % 60} seconds${rec.running ? '' : ', clock stopped'}. ${q ? prompt(q, ctx) : ''}`;
    announce(line.trim(), 'saved');
  };

  const apply = (r: FlowResult) => {
    if (r.plays.length) rec.record(r.plays, { shot: r.clock?.shot, stop: r.clock?.stop });
    switch (r.control) {
      case 'undo': {
        const gone = rec.undo();
        setQuestion(null);
        return announce(gone?.length ? `Undid ${gone.map((e) => describe(e, rec)).join(' and ')}.` : 'Nothing to undo.', gone?.length ? 'undo' : 'error');
      }
      case 'toggleClock':
        rec.toggleClock();
        return announce(rec.running ? 'Clock stopped.' : 'Clock running.', 'saved');
      case 'nextPeriod':
        rec.setPeriod(rec.period + 1);
        setQuestion(null);
        return announce(`${periodLabel(rec.period + 1)}. Clock reset.`, 'saved');
      case 'readout':
        return readout(r.next);
      default:
        setQuestion(r.next);
        announce(r.say, r.buzz);
    }
  };

  // After any play, someone on court with five fouls must go: ask unless another question is open.
  const askedFor = useRef<number | null>(null);
  useEffect(() => {
    if (question) return;
    const q = forcedSub(ctx);
    if (q && q.k === 'forcedSub' && askedFor.current !== q.outId) {
      askedFor.current = q.outId;
      setQuestion(q);
      announce(prompt(q, ctx), 'question');
    }
    if (!q) askedFor.current = null;
    // Re-check only when the plays change.
  }, [rec.events]);

  const submit = (t: string) => {
    if (!t.trim()) return;
    apply(onText(t, question, ctx));
    setText('');
  };
  const swipe = (dir: 'right' | 'left' | 'up' | 'down') => {
    if (dir === 'down') return apply({ plays: [], next: null, say: '', buzz: 'undo', control: 'undo' });
    if (dir === 'up') return apply({ plays: [], next: question, say: '', buzz: 'saved', control: 'toggleClock' });
    apply(onSwipe(dir, question, ctx));
  };

  // ---- Gestures on the pad ----
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTap = useRef(0);
  const holdTimer = useRef<number>();
  const onDown = (e: RPointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    window.clearTimeout(holdTimer.current);
    // Hold: open the keyboard (in place of the prototype's hold-to-talk).
    holdTimer.current = window.setTimeout(() => {
      start.current = null;
      inputRef.current?.focus();
      buzz('saved');
    }, 650);
  };
  const onMove = (e: RPointerEvent) => {
    if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 12) window.clearTimeout(holdTimer.current);
  };
  const onUp = (e: RPointerEvent) => {
    window.clearTimeout(holdTimer.current);
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 48) {
      swipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 350) {
      lastTap.current = 0;
      readout();
    } else lastTap.current = now;
  };

  // Laptop testing: arrow keys swipe, S reads the score (while the text box isn't focused).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current || help) return;
      const map: Record<string, 'right' | 'left' | 'up' | 'down'> = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };
      if (map[e.key]) {
        e.preventDefault();
        swipe(map[e.key]!);
      } else if (e.key === 's' || e.key === 'S') readout();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ---- Chips for the open question ----
  const court = (side: Side) => ctx.players.filter((p) => p.side === side && p.onCourt);
  const jerseyChip = (p: { jersey: string; side: Side }, prefix = '', suffix = ''): Chip => ({
    label: `${prefix}#${p.jersey}`,
    text: `${rec.game[p.side].shortName.toLowerCase()} ${p.jersey}${suffix}`,
    color: SIDE_COLOR[p.side],
    jersey: true,
  });
  let chips: Chip[] = [];
  const q = question;
  if (!q) chips = [...court('home'), ...court('away')].map((p) => jerseyChip(p));
  else if (q.k === 'assist') chips = [...court(q.side).filter((p) => p.playerId !== q.scorerId).map((p) => jerseyChip(p)), { label: 'No assist', swipe: 'left' }];
  else if (q.k === 'rebound')
    chips = [
      ...court(q.shotSide).map((p) => jerseyChip(p, 'O ', ' o')),
      ...court(q.shotSide === 'home' ? 'away' : 'home').map((p) => jerseyChip(p, 'D ', ' d')),
      { label: 'Skip', swipe: 'left' },
    ];
  else if (q.k === 'fouled' || q.k === 'stealVictim' || q.k === 'stealer')
    chips = [...court(q.side).map((p) => jerseyChip(p)), ...(q.k === 'fouled' && q.n ? [] : [{ label: q.k === 'stealer' ? 'No steal' : 'Skip', swipe: 'left' as const }])];
  else if (q.k === 'forcedSub') chips = [...ctx.players.filter((p) => p.side === q.side && !p.onCourt && p.fouls < 5).map((p) => jerseyChip(p)), { label: 'Later', swipe: 'left' }];
  else if (q.k === 'foulKind')
    chips = [
      { label: 'Personal', swipe: 'right' },
      { label: 'Shooting 2', text: 'shooting 2' },
      { label: 'Shooting 3', text: 'shooting 3' },
      { label: 'And-one', text: 'and one' },
      { label: 'Offensive', text: 'offensive' },
      { label: 'Unsportsmanlike', text: 'unsportsmanlike' },
      { label: 'Cancel', swipe: 'left' },
    ];
  else if (q.k === 'ft') chips = [{ label: 'Made', swipe: 'right' }, { label: 'Missed', swipe: 'left' }];
  else if (q.k === 'whichTeam') chips = [{ label: `Home · ${rec.game.home.shortName}`, swipe: 'right' }, { label: `Away · ${rec.game.away.shortName}`, swipe: 'left' }];

  const pressChip = (c: Chip) => {
    if (c.swipe) return swipe(c.swipe);
    // With no question open, a jersey chip starts the command and a play chip finishes it.
    if (!q && c.jersey) {
      setText(`${c.text} `);
      return;
    }
    submit(c.text!);
  };
  const playReady = !q && /\d/.test(text);

  const setPref = (k: 'speak' | 'vibrate') => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    writeJson(PREFS_KEY, next);
  };

  const s = rec.box.score;
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 520, width: '100%', mx: 'auto' }}>
      {/* Score bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, bgcolor: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: '12px', p: '8px 12px' }}>
        <Box sx={{ fontFamily: display, fontSize: 30, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          <Box component="span" sx={{ color: SIDE_COLOR.home }}>{rec.game.home.shortName} {s.home}</Box>
          <Box component="span" sx={{ color: C.muted, mx: 0.75 }}>–</Box>
          <Box component="span" sx={{ color: SIDE_COLOR.away }}>{s.away} {rec.game.away.shortName}</Box>
        </Box>
        <Box sx={{ textAlign: 'right', fontSize: 12, color: C.muted, lineHeight: 1.3 }}>
          <Box sx={{ fontFamily: display, fontSize: 22, fontWeight: 700, color: rec.running ? C.text : C.amber }}>
            {periodLabel(rec.period)} {fmtClock(rec.clock)}
          </Box>
          shot {rec.shot ?? '—'} · {rec.running ? 'running' : 'stopped'}
        </Box>
      </Box>

      {/* Gesture pad */}
      <Box
        role="application"
        aria-label="Gesture pad. Swipe right yes, left no, down undo, up clock. Double tap reads the score. Hold to type."
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          window.clearTimeout(holdTimer.current);
          start.current = null;
        }}
        sx={{
          flex: 1,
          minHeight: 220,
          touchAction: 'none',
          userSelect: 'none',
          position: 'relative',
          borderRadius: '18px',
          border: `1.5px solid ${q ? C.amber : C.strongBorder}`,
          bgcolor: '#121821',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 1.5,
          p: '28px 20px',
          cursor: 'grab',
          '&:focus-visible': { outline: `2px solid ${C.amber}`, outlineOffset: 2 },
        }}
      >
        <Box aria-hidden="true" sx={{ position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: C.dim }}>▲ clock</Box>
        <Box aria-hidden="true" sx={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: C.dim }}>▼ undo · double tap = score · hold = type</Box>
        <Box aria-hidden="true" sx={{ position: 'absolute', left: 8, top: '50%', fontSize: 11, color: C.dim, transform: 'translateY(-50%)' }}>◀ no</Box>
        <Box aria-hidden="true" sx={{ position: 'absolute', right: 8, top: '50%', fontSize: 11, color: C.dim, transform: 'translateY(-50%)' }}>yes ▶</Box>
        <Kicker color={q ? C.amber : C.muted}>{q ? 'Question' : 'Ready'}</Kicker>
        <Box aria-live="polite" sx={{ fontFamily: display, fontSize: { xs: 26, sm: 30 }, fontWeight: 600, lineHeight: 1.15, px: 1.5 }}>
          {q ? prompt(q, ctx) : said}
        </Box>
        {q && (
          <Box sx={{ fontSize: 13, color: lastBuzz === 'error' ? C.warn : C.muted, px: 1.5 }}>{said}</Box>
        )}
        {!q && lastBuzz === 'error' && <Box sx={{ fontSize: 13, color: C.warn, px: 1.5 }}>Try again.</Box>}
      </Box>

      {/* Chips */}
      <Box role="group" aria-label={q ? 'Answers' : 'Players on court'} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {chips.map((c) => (
          <Btn key={`${c.label}-${c.text ?? c.swipe}`} onClick={() => pressChip(c)} sx={{ minHeight: 44, px: 1.5, fontFamily: display, fontSize: 19, fontWeight: 600, color: c.color ?? C.text, borderColor: c.color ?? C.buttonBorder }}>
            {c.label}
          </Btn>
        ))}
      </Box>
      {!q && (
        <Box role="group" aria-label="Plays" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {PLAY_CHIPS.map((p) => (
            <Btn key={p} disabled={!playReady} onClick={() => submit(`${text} ${p}`)} sx={{ minHeight: 40, px: 1.25, fontSize: 13 }}>
              {p}
            </Btn>
          ))}
        </Box>
      )}

      {/* Typed command */}
      <Box component="form" onSubmit={(e: FormEvent) => { e.preventDefault(); submit(text); }} sx={{ display: 'flex', gap: 0.75 }}>
        <Box
          component="input"
          ref={inputRef}
          aria-label="Command or answer"
          value={text}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
          placeholder={q ? 'Type the answer, e.g. 12' : '7 three made · 12 rebound · 5 foul'}
          sx={{ flex: 1, minWidth: 0, minHeight: 50, px: 1.5, borderRadius: '10px', border: `1px solid ${C.buttonBorder}`, bgcolor: C.bg, color: C.text, font: 'inherit', fontSize: 16, '&::placeholder': { color: C.dim } }}
        />
        <Btn sx={{ minHeight: 50, px: 2, border: 'none', bgcolor: C.text, color: C.bg, fontWeight: 600 }}>Enter</Btn>
      </Box>

      {/* Gesture buttons, readback and vibration */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 0.75 }}>
        <Btn onClick={() => swipe('left')} label="No, missed, skip (swipe left)" sx={{ minHeight: 44, fontSize: 13 }}>◀ No</Btn>
        <Btn onClick={() => swipe('right')} label="Yes, made, confirm (swipe right)" sx={{ minHeight: 44, fontSize: 13 }}>Yes ▶</Btn>
        <Btn onClick={() => swipe('down')} label="Undo (swipe down)" sx={{ minHeight: 44, fontSize: 13 }}>▼ Undo</Btn>
        <Btn onClick={() => swipe('up')} label="Start or stop the clock (swipe up)" sx={{ minHeight: 44, fontSize: 13 }}>▲ Clock</Btn>
        <Btn onClick={() => readout()} sx={{ minHeight: 40, fontSize: 12 }}>Read score</Btn>
        <Btn pressed={prefs.speak} onClick={() => setPref('speak')} sx={{ minHeight: 40, fontSize: 12, color: prefs.speak ? C.text : C.dim }}>
          Voice {prefs.speak ? 'on' : 'off'}
        </Btn>
        <Btn pressed={prefs.vibrate} onClick={() => setPref('vibrate')} sx={{ minHeight: 40, fontSize: 12, color: prefs.vibrate ? C.text : C.dim }}>
          Buzz {prefs.vibrate ? 'on' : 'off'}
        </Btn>
        <Btn onClick={() => setHelp(true)} sx={{ minHeight: 40, fontSize: 12 }}>Guide</Btn>
      </Box>

      <PhoneGuide open={help} onClose={() => setHelp(false)} />
    </Box>
  );
}

const GUIDE: [string, string][] = [
  ['Swipe →', 'Yes · made · confirm · personal foul · home'],
  ['Swipe ←', 'No · missed · skip · cancel · away'],
  ['Swipe ↓', 'Undo the last entry (it says what it removed)'],
  ['Swipe ↑', 'Start or stop the game clock'],
  ['Double tap', 'Read out the score, clock and any open question'],
  ['Hold', 'Open the keyboard to type a command'],
];
const BUZZES: [string, string][] = [
  ['One short', 'Saved'],
  ['Two short', 'A question is waiting'],
  ['One long', 'Didn’t catch it, try again'],
  ['Three quick', 'Undone or cancelled'],
];
const PHRASES = ['7 three made', '21 two missed', '12 defensive rebound', '5 foul', '5 shooting foul 3', '2 steal', '2 steal 7', '9 block', '30 turnover', '30 turnover 5', '4 assist', '7 free throw made', '24 in 5 out', 'timeout home', 'home 7 two made', 'score', 'undo', 'next quarter'];

/** How to use the phone recorder (the prototype's Phone guide), without the voice parts. */
export function PhoneGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const table = (rows: [string, string][]) => (
    <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 14 }}>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ display: 'contents' }}>
          <Box component="dt" sx={{ fontFamily: display, fontSize: 18, fontWeight: 600, color: C.amber }}>{k}</Box>
          <Box component="dd" sx={{ m: 0, color: C.soft, alignSelf: 'center' }}>{v}</Box>
        </Box>
      ))}
    </Box>
  );
  return (
    <Dialog open={open} onClose={onClose} PaperProps={{ sx: { bgcolor: C.panel, color: C.text, border: `1px solid ${C.panelBorder}`, borderRadius: '16px', p: 3, maxWidth: 480 } }}>
      <Kicker color={C.amber}>Phone guide</Kicker>
      <Box component="h2" sx={{ m: '4px 0 12px', fontFamily: display, fontSize: 30, fontWeight: 600 }}>Record without looking</Box>
      <Box sx={{ fontSize: 14, color: C.soft, mb: 2 }}>
        The whole middle of the screen is one pad. Type (or tap a jersey, then a play), and every entry is read back aloud and confirmed with a buzz. Questions follow like on the tablet: assist, rebound, foul kind → who was fouled → free throws, steal → who lost it, turnover → who stole it, and a substitute after a fifth foul.
      </Box>
      {table(GUIDE)}
      <Box sx={{ mt: 2.5, mb: 1, fontWeight: 600 }}>Buzz codes</Box>
      {table(BUZZES)}
      <Box sx={{ mt: 2.5, mb: 1, fontWeight: 600 }}>Phrases</Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {PHRASES.map((p) => (
          <Box key={p} component="code" sx={{ fontSize: 13, bgcolor: C.button, border: `1px solid ${C.buttonBorder}`, borderRadius: '6px', px: 0.75, py: 0.25 }}>{p}</Box>
        ))}
      </Box>
      <Box sx={{ mt: 2, fontSize: 12, color: C.muted }}>
        Rebounds: the jersey alone is enough (the shooting team’s player is offensive); add o or d when both teams wear it. Vibration works on Android; iPhone Safari doesn’t support it. On a laptop: arrow keys swipe and S reads the score.
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
        <Btn onClick={onClose} sx={{ border: 'none', bgcolor: C.text, color: C.bg, fontWeight: 600 }}>Got it</Btn>
      </Box>
    </Dialog>
  );
}
