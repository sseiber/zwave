# Web UI principles

The decisions behind the web client, written down because most of them came from
testing on a wall-mounted tablet and are not obvious from the code. If a change would
break one of these, that is worth a conversation first.

## Touch before mouse

The primary device is a **touch screen**, often used one-handed while walking past.

- **Scrolling beats pressing.** A drag that starts on a button scrolls the page and
  never activates it. Buttons use `touch-action: manipulation`; only the dimmer sliders
  claim horizontal drags (`pan-y`). `src/press.ts` deliberately does *not* drive
  activation — the browser's click does — it only adds a subtle `.is-pressed` highlight,
  dropped once the finger travels 10px.
- **Feedback must be visible but not alarming.** The press highlight is a brightness
  shift, not a colour inversion; a finger sweeping past a button should not light it up.
- **Targets are finger-sized.** 40px minimum on buttons; small marks (timeline runs,
  device dots) get a transparent hit area around them.
- **Transient results are toasts** that rise over the bottom nav, auto-dismiss and take
  no layout space. Persistent *state* (inclusion active) stays an inline banner.

## Glance, don't read

The app is an instrument panel, not documentation. Repeated feedback: prose is clutter.

- **Instruments first, words last.** In the Health view the chart, dots and meters are
  the working surface; advice and explanations live in labelled blocks at the bottom.
- **Draw comparisons rather than describing them.** A device's signal is a meter against
  the usable range with the mesh's own median marked, not a sentence containing a dBm
  figure.
- **Roll-ups are fixed height.** A dashboard card never grows a row per device.
- **Say what to do, including "nothing".** A working mesh of older devices should be
  told it is fine, not handed a score to interpret.

## One rhythm

Spacing and type come from scales declared once in `:root` (`--s-1`…`--s-6`,
`--t-micro`…`--t-num`), not from numbers chosen at each call site. Before them the
sheet held 25 spacing values and 24 font sizes, with almost all text between 0.6 and
0.9rem — which is what "cluttered" looked like in CSS.

- **Pick a step, don't invent a value.** If nothing fits, add a step; a one-off number
  is how the drift started.
- **Rhythm is not geometry.** Dot diameters, timeline offsets and meter track widths
  are drawing, and stay literal.
- **Body text is 0.95rem at 1.5 line-height.** Sizes below `--t-micro` (0.75rem) are
  for badges, not for anything anyone has to read.
- **One label treatment.** The quiet uppercase name over a group is a single rule
  shared by every view.

## Predictable controls

- **Controls do not morph.** Filter options are a fixed checkbox set — only the counts
  beside them change. Result lists may change in real time; the controls above them may
  not. On/Off stays two fixed targets rather than one toggle: on a wall panel, "turn it
  off" should be one deterministic tap, not a tap whose result depends on a state you
  have to read first. Only the highlight moves.
- **One card per row** at every width (`.dash-grid`, `.scene-tiles`), matching the
  device list. No masonry that reflows as the window changes.
- **One place per action.** The bottom nav reaches every view, so cards carry no
  navigation links. Dashboard cards report; the section views act. The views name
  themselves, so there is no standing app title above them.
- **A badge everything carries says nothing.** Every device row used to show an "alive"
  pill and a power figure — 23 identical badges and a column of "0 W". Status and
  readings appear only when they differ from the ordinary case, which is what makes a
  red DEAD pill worth seeing.
- **A fact appears once per screen.** The Dashboard used to carry "23/23 responding" and
  "Offline: 0" on two different cards. Same fact, twice the reading.
- **The verdict is not a card.** "Is anything wrong?" is the page speaking, so it sits
  above the cards without chrome — and it is the only thing on the home screen that
  changes colour.
- **Colour means status.** Cards carry an accent edge at rest; amber or red appears only
  when something actually needs attention.

## Health specifically

- Judge **"is it working?"**, not "is it ideal?". Reliability (drops, timeouts, silence)
  leads. Weak signal alone never condemns a device: Z-Wave receivers work to about
  -95 dBm and 40 kbps routes are normal for older gear.
- Thresholds live in one `Thresholds` block in `services/networkHealth.ts` and have been
  retuned twice against a real 23-device mesh. Retune there, with real numbers.
- The background sweep exists so the view is **alive**: one device pinged per minute,
  the swept dot ringed in the UI.
- **One instrument, one unit.** Noise (dBm), errors (%) and reply time (ms) get a
  sparkline each rather than sharing a plot against two axes — series on unrelated
  scales bunch together and read as nothing. Every reading in the view, trend or device,
  is drawn as `label · instrument · value`.
- **Round what you show.** A reading rendered straight from a driver value will happily
  print `169.08130580728164 ms`.
- **The axis is the threshold, not a round number.** Each trend is scaled so the top of
  the row is the reading the score calls Poor and the dashed line is where it starts to
  care (`Thresholds` in `services/networkHealth.ts`). Height then means something, and
  the row spends itself on the range that matters instead of on headroom nothing
  reaches. All three run **worse-upward**, so low flat lines are a healthy mesh.
- **Never auto-fit a trend axis to its data.** A mesh sitting at -95 dBm give or take a
  dB would have that jitter stretched to fill the row, inventing alarm out of nothing.
  Where "usual for this mesh" genuinely matters, mark the average as a reference line —
  the service already judges noise that way.
