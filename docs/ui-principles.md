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

## Predictable controls

- **Controls do not morph.** Filter options are a fixed checkbox set — only the counts
  beside them change. Result lists may change in real time; the controls above them may
  not.
- **One card per row** at every width (`.dash-grid`, `.scene-tiles`), matching the
  device list. No masonry that reflows as the window changes.
- **One place per action.** The bottom nav reaches every view, so cards carry no
  navigation links. Dashboard cards report; the section views act.
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
