# Sandtable design

A dense developer tool in Linear's look, after the `linear-design` skill: dark first, quiet
near-neutral surfaces that step up a little per level, one indigo accent, thin translucent lines,
and fast ease-out motion. The tokens live in `src/renderer/src/styles/tokens.css`; components use
them through Tailwind classes and never name a raw color.

## Color

- Surfaces step about 2 to 3% lightness per level. `window` is behind the sidebar and `panel` is
  what every view sits in; the panel is always the lighter one: `surface` on a `surface-2` window
  in light mode, and `surface-2` on a `surface` window in dark. Side panes inside the panel (the
  chat panel, the Changes file list and Findings rail, and the ticket view's chat rail), the routine editor's
  **Build with Claude** chat, and the setup guide's
  command box use the `window` fill. shadcn's `card` the cards and raised boxes, `card-hover` a hovered
  card, `surface-3` other hovers, `neutral-soft` Markdown's inline code and code blocks, which
  stay visible on any surface, and `raised` the
  dialogs, select menus, the **Display**, **Filters**, and **Assignees** menus and their submenus, the sidebar's **More** menu and its **Routines** submenu, a routine pill's menu, the
  emoji popover, the conversation's **Your messages** popover, find bar, and command palette, tooltips, and the copy of a dragged sidebar row. In dark mode they step lighter, with `card`, `card-hover`,
  and `raised` each a step above the last; in light mode, darker, with `card-hover` equal to
  `surface-3` and `raised` white.
- Text has four levels: `fg` for content, `fg-2` for supporting text, `fg-3` for metadata, and
  `fg-4` for disabled and placeholder text, the **Cache read** shade in **Usage**, and diff line
  numbers.
- Lines are `line` and the stronger `line-2`; in dark mode both are white at low alpha, so they
  suit any surface.
- `accent` (indigo) is the only brand color, used only for focus, selection, links, drop targets,
  checked checkboxes and switches, and the **Done** status
  icon and its list header's tint. Buttons never use it. The focus ring is `focus` (the accent), text selection and
  find matches are `selection` (the accent mixed with 64% transparency), the current find match
  is `find-current` (the accent mixed with 30% transparency), and links are `accent-bright`, which keeps
  4.5:1 on `panel`, on the `window` fill of the chat panel, the routine editor's chat, and the Findings rail, and on the
  `card` fill of your chat messages, the only surfaces links appear on (in Markdown, and the
  rail's pull request titles): 5.3:1, 5.0:1, and 4.8:1 in light mode, 5.0:1, 5.2:1, and 4.6:1 in
  dark. It falls short on `raised` and
  `card-hover` in dark mode. No second decorative hue.
- shadcn's variables (`background`, `border`, `primary`, ...) map onto these tokens.
- Light and dark values follow `prefers-color-scheme`, which the **Appearance** setting drives:
  **System** (the default) follows macOS, and **Light** or **Dark** forces one scheme through
  Electron's `nativeTheme.themeSource`. Every color token has a value in both.
- A diff's added and removed lines have their own tokens, `added` (green) and `removed` (red), each
  with a `-soft` tint for the line's row. Outside the diff they mark only the **Ready to merge**
  chip, a passing check's dot in the Findings rail, and, `added` alone, the **Done** session state:
  its chip, count, and routine pill. The `+` or `−` before the line says which it
  is; the color only backs it up.
- Status colors mark state only, never decoration. Every colored text keeps WCAG AA (4.5:1) on
  its background in both schemes.
- Session states are chips with a 12 px icon in the text color and a word, never a color or an
  icon alone: **Needs you** is `amber` (Linear's orange) on `amber-soft` with `CircleAlert`,
  **Running** is `blue` on `blue-soft` with `CircleDot`, **Idle** is `fg-2` on `neutral-soft`
  with `CirclePause`, **Finished** is `neutral` on `neutral-soft` with `CircleCheck`, and
  **Done**, a routine session that ended its turn without asking, is `added` on `added-soft` with
  `CircleCheckBig`. **Reviewing**, while an automatic review round runs, is `blue` on `blue-soft`
  with `ScanSearch`, whose opacity pulses to 55% and back every 1.6 s. **Done,
  session open** is `neutral-soft` with `fg` text, a 1 px `line-2` inset ring, and
  `CircleDashed`; a sidebar session row shortens it to **Done**, with "Done, session open" as
  its accessible name. **Limit reached** is `fg-2` on `neutral-soft` with `Hourglass`, followed by
  the reset time, as "Limit reached · Resets 16:00". **API error** is `danger` on `danger-soft`
  with `TriangleAlert`, and its chip's tooltip is Claude Code's one-line message. A **Needs you** sidebar row follows its badge with "asking" or "capped" in
  `fg-3`, hidden like the badge's word in a narrow sidebar but kept in its name. A sidebar session row's tooltip is its full title and state word, as
  "Rate limits — Idle", and a live session's usage on a line of its own. **Can't start** is `danger` on `danger-soft` with
  `CircleX`. The sidebar's per-project count is the bare number with `CircleAlert` in the same
  `amber` on `amber-soft`, with "3 need you" (or "1 needs you") as its accessible name and
  tooltip; the total beside **Show sidebar** is the same chip in those words. A collapsed
  project's **Running**, **Reviewing**, **Idle**, **Done**, and **Done, session open** counts are
  the same bare chip in that state's colors and icon, named "2 running", "1 reviewing", "1 idle",
  "1 done", or "1 done, session open"; the **Reviewing** count's icon pulses too. A
  project's count chips take keyboard focus, and their tooltip is the count in words followed by
  the title of each session in that state, one per line.
- Pull request states are chips with a word: **Open** is `blue` on `blue-soft`, **Merged** is
  `fg` on `neutral-soft`, and **Closed** is `fg-3` on `neutral-soft`. Where an open pull request
  stands is a chip with a 12 px `GitPullRequest` icon and a word: **PR open** is `blue` on
  `blue-soft`, **Conflicts** and **Checks failing** `danger` on `danger-soft`, **Changes requested** `amber` on
  `amber-soft`, and **Ready to merge** `added` on `added-soft`.
- Ticket statuses have drawn 14 px icons, not `lucide`'s circles, which mark session states: **To
  do** is an empty ring in `fg-3`, **In progress** a ring with its right half filled in `yellow`,
  and **Done** a filled `accent` circle with a check in `surface`. Each starts its board column
  heading and follows the chevron in its list group header, always beside the status's name. `yellow` is only for **In
  progress** and a pending check's dot in the Findings rail; `amber` is **Needs you**'s, and otherwise only marks a warning: the readiness check's
  **Not ready** chip, the overlap check's **Overlaps** chip, the setup guide's warning rows, the **Changes requested** chip, a
  **Medium** finding's severity, and a Run history run's **Waiting on** line, and the routine editor's **Written for** note.
- No gradients anywhere; tints are flat.
- Errors use `danger` (Linear's red) text on `danger-soft`.
- Label colors come from the ticket source's data, GitHub's or Linear's, and only fill a label's dot, on cards, list rows, in
  the ticket view, and in the board's **Filters** menu, where a checked label that no ticket has any
  more shows only the ring. A 1 px `line-2` inset ring keeps a white or pale dot visible. Jira
  labels have no color, so their dots show only the ring.
  Sandtable's `sandtable: in progress` label keeps its fixed GitHub color in the ticket view and
  appears nowhere else in Sandtable.

## Type

- System UI font at 13 px; 11 px for labels and metadata.
- A project's emoji is 15 px (`text-emoji`), in the sidebar tile and the board header.
- Issue numbers (`#147`) and ticket keys are monospace.
- Page headings in the add-project flow are 18 px, weight 500; section headings in the ticket
  details are 11 px, weight 500, in `fg-3`.

## Shape and space

- There are three shapes. Pills (`rounded-full`) for every button, toggle and segmented control,
  switch, chip, badge, sidebar row and heading, and the project tile. `radius` (8 px) for fields,
  the activity strip,
  menu and select items, row-shaped buttons (list group headers, assignee lane header buttons,
  file and project lists, step rails, tool-call rows, emoji cells), a collapsed lane's count
  boxes, the grouped list's status subgroups, alerts, tooltips, code blocks, inset boxes such as the setup guide's command box and
  Usage's price box, skeletons, the conversation's tray rows, a dragged list row's copy, the Details sub-issue and parent lists, and a card's sub-issue list and its rows. `radius-card` (12 px) for the panel, cards, columns, assignee lane panels and their cells, the toolbar bar, dialogs, menus,
  popovers, the Settings rows, radio boxes, and the New ticket composer and placeholders.
- Raised surfaces (dialogs, alert dialogs, select menus, the **Display**, **Filters**, **Assignees**, and **More** menus and their submenus, the emoji popover,
  the boxes in the add-project flow, and the rows on the Settings screen) share one style:
  `radius-card` corners, no border, and a fill that sets them off from what's behind them.
  Board cards have `radius-card` corners, the `card` fill, and a 1 px `line` inset ring instead of a
  shadow. The copy of a card being dragged has `shadow-md`, and dialogs,
  alert dialogs, select menus, the **Display**, **Filters**, **Assignees**, and **More** menus and their submenus, and the emoji popover float over the page with `shadow-lg`.
  A clickable one steps its fill up on hover.
- The panel every view sits in has `radius-card` corners and a 1 px `line` border.
- Fields, select triggers, and outline buttons keep their 1 px borders. Board columns have
  `radius-card` corners.
- Buttons with words are 28 px tall, 24 px when small, 20 px in a card's action row,
  **Clear Needs you**, **Raise cap**, and the readiness and overlap checks, and 36 px only in the add-project flow
  and the setup guide that shares its layout, beside its 36 px fields. Icon buttons are 28 px
  unless a line names another size. Primary buttons are `fg` with `surface` text, near-black in
  light mode and near-white in dark, at 85% on hover. Destructive buttons (**Delete**, **Clean up**,
  **Start over**, and the session card's end and remove confirmations) are `danger` text with a
  1 px `danger` 45% border and no fill, with `danger` at 6% on hover; a `danger-soft` fill, or
  8% on hover, drops below 4.5:1 on `raised` in dark mode. Every other button is outline or ghost.
- Dialogs and alert dialogs share one layout, apart from the [routine editor](#routine-editor)'s
  880 px chat layout: 448 px wide, 16 px padding, 12 px gaps, a 13 px
  weight-500 title, a `fg-2` description, and a right-aligned footer of 28 px buttons. A
  dialog's close button is a ghost 24 px icon button in `fg-3` with the tooltip "Close", 12 px from
  the top and right.
  Alert dialogs have no close button. Both sit on `raised` with `shadow-lg` and a 1 px `line-2`
  ring around the outside, so the edge stays clear on the dimmed page in dark mode, where the shadow
  doesn't show. Behind both, the page dims under `scrim`: `fg` at 32% in light mode and black at 40%
  in dark.
- 4 px spacing unit.
- Board columns are 350 px wide and 12 px apart, inside 12 px of padding. Each column scrolls on
  its own under a header that stays put, with no tint behind its cards. Cards are
  8 px apart, 12 px in from the column's left side and 16 px from its right, so the scroll bar has
  its own gutter.

## Motion

- Timing comes from the tokens: `speed-highlight-in` (0 s), `speed-highlight-out` (150 ms),
  `speed-quick` (100 ms) for color and opacity, `speed-regular` (250 ms) for size and position,
  `speed-slow` (350 ms), and the curves `ease-out-quad`, `ease-out-cubic`, `ease-out-quart`,
  `ease-in-out-cubic`, and `ease-drawer`.
- Hover highlights appear at once and fade out over 150 ms: the `highlight` utility on buttons,
  sidebar rows, chips, fields, and select triggers, and the fill on board cards and radio boxes.
  Pressing a button changes its color at once too; buttons don't scale.
- The focus ring fades in over 300 ms ease-out after a 400 ms delay and leaves over 150 ms ease-in.
  Checkboxes change background and border over 80 ms ease-out. A switch's track changes color over
  100 ms and its thumb slides over 150 ms, both ease-out. A select's caret turns over 100 ms
  ease-in-out; a sidebar project's chevron and a list group header's chevron turn over 150 ms with
  `ease-out-quart`, at once with reduced motion; so does an assignee lane's chevron, and a card's sub-issue chip's chevron. List groups
  and assignee lanes collapse and expand at once.
- Overlays (dialogs, alert dialogs, menus, selects, popovers, tooltips) open and close with no
  animation, apart from the conversation's find bar and command palette. A tooltip opens 400 ms after the pointer rests on its control, and at once on keyboard
  focus or when another tooltip closed less than 300 ms before. The board's **To clean up** and **Run history** panels are drawers: each slides in from the right over
  250 ms with `ease-drawer` and leaves over 150 ms; with reduced motion it appears and goes at
  once. The terminal drawer in a session's conversation slides up from the bottom and back down
  over 250 ms with `ease-drawer`, at once with reduced motion. List navigation and anything repeated
  many times a minute also responds at once.
- Entrances use opacity plus a 5 to 10 px slide or `scale(.95)` to 1, ease-out, at most 250 ms;
  exits are faster. Nothing bounces or overshoots. Movement uses only opacity, transform, and
  filter, except the sidebar's slide, the panel margin that moves with it, and the activity
  strip's height as its earlier steps open, and a conversation's glide to its end; color changes can fade. Nothing outside a drawer runs longer than 350 ms,
  apart from looping indicators (spinners and the working line) and that glide, which uses the browser's smooth scroll over at most one view's height.
- Spinners turn once per 700 ms.
- The working line, which the session conversation, the ticket chat, and the routine chat share,
  is an 18 px raised tool key and one line of text in `fg-3`. The key is a 5 px-radius tile from
  `surface` to `surface-3` with a 1 px `line-2` inset ring and `card-shadow`, holding the 11 px
  icon of Claude's latest step in `fg-3`, or `Sparkles` before the first step. The text is that
  step's words, the verb and its target in monospace, cut with an ellipsis and in full on hover,
  or the line's own words, such as "Claude is working…", before the first step. In the session
  conversation, a step from before your latest prompt doesn't count. Only the latest
  step shows; a new step replaces it. A shimmer, a band of `fg` across the `fg-3` text, sweeps
  left every 2.4 s. When the step's tool changes, the key flips in from 90° on its horizontal axis
  over 200 ms with `ease-out-cubic`, and between steps it tilts gently every 2.4 s; a new step's
  words fade in and rise 6 px over 200 ms with `ease-out-cubic`. The status that screen readers
  hear keeps the line's own words for the whole turn, so a step change isn't announced; the step's
  words stay readable by browsing. With reduced motion the shimmer, the flip, the tilt, and the
  rise stop, and a new step's words only fade in.
- The activity strip's earlier steps open and close by growing their row from nothing to their
  height over 200 ms with `ease-out-cubic`, and its chevron turns over 150 ms with `ease-out-quart`,
  like the sidebar's chevrons; with reduced motion both happen at once.
- A dragged card's, list row's, or sidebar row's copy has its shadow at once, and on drop the copy
  settles into place over 200 ms with `ease-out-quad`; with reduced motion it drops in place with no
  animation. The column, lane cell, lane count, or list group header under a dragged card or row
  gains its ring over `speed-highlight-out` (150 ms) with `ease-out-quad`, as does a collapsed
  lane's panel during the 700 ms hold that opens it.
- A scheme change switches surfaces and text at once; controls with the `highlight` utility fade
  to their new colors over 150 ms.
- The sidebar slides in and out over `speed-regular` (250 ms) with `ease-out-quart`, by moving its
  left margin by its own width so the view beside it widens with it, while the panel's left
  margin moves between 0 and 8 px with it; these and the activity strip's height are the only
  movements that aren't transforms. With reduced motion
  both happen at once.
- With reduced motion, transforms drop: every slide, rise, or scale becomes a short opacity fade,
  carets and switch thumbs jump, conversations jump to their end, the find bar and command palette
  appear at once, spinners stand still, the working line's shimmer and tool key stop, and
  **Reviewing**'s icon stops pulsing.

## Layout

- The window has no title bar (`hiddenInset`). The sidebar sits on `window`, and every view sits
  in the panel, the setup guide included, 8 px in from the window's top, right, and bottom edges and flush against the
  sidebar, or 8 px in from the left edge while the sidebar is hidden, in full screen too. The
  window controls sit 16 px in, centered 30 px down, on the panel's first 44 px row. Every view's
  header is 44 px tall with no rule under it, and the sidebar's top strip is 52 px with 8 px of
  padding at its top, so the controls line up with both. The strip and the empty parts of each
  header drag the window; their buttons stay clickable, and the 8 px margin around the panel and
  the **Resize sidebar** separator don't drag.
- Every icon-only button has a tooltip and an accessible name in the same words; the tooltip adds
  the shortcut in parentheses when there is one, as "Hide sidebar (⌃⌘S)". A tooltip is 11 px `fg`
  text on `raised` with `shadow-lg`, `radius` corners, 8 px and 4 px padding, at most 384 px wide, wrapping only past that width or at a line break, 4 px from its
  control. A disabled button shows no tooltip but keeps its name. Buttons with words never get a
  tooltip that repeats them.
- A ghost 28 px icon button labeled **Hide sidebar**, in `fg-2`, sits at the end of the sidebar's strip,
  just before **Go back** and **Go forward**, with the tooltip "Hide sidebar (⌃⌘S)". While the
  sidebar is hidden, a matching **Show sidebar** starts the view's header, 88 px from the panel's edge,
  followed by **Go back** and **Go forward**, then the total "3 need you" (or "1 needs you") in `amber` on `amber-soft` when any session needs you.
  **View > Hide Sidebar** or **Show Sidebar** and Control+Command+S do the same. After a separator,
  **View > Next Needs You** (⇧⌘J) follows, disabled while nothing needs you. Whenever the
  window controls show and no sidebar is beside a header, as on the setup guide, the header starts
  88 px in; in full screen the controls hide and headers keep their 16 px padding.
- The ticket and session view headers share one layout of groups. What the view is about fills
  the left; only its title shrinks, truncating to a 48 px floor, and the Back button, key, and
  chips beside it keep their width. On the right sit only the session's state chip, the buttons
  that need you (**Clear Needs you** and **Raise cap**), and the **Context** button while the
  [Gauges panel](#gauges-panel) isn't on screen. Every other session detail, the model, live
  tokens, latest step, branch and folders, and **Sandboxed**, lives in the panel, so no session
  detail shows in both. The pull request chip on the left is the ticket's own, from the board,
  and shows with or without a session. The session view adds a 1 px by 20 px `line` rule, then its actions.
- Ghost 28 px icon buttons **Go back** (`ChevronLeft`) and **Go forward** (`ChevronRight`), in
  `fg-2`, end the sidebar's strip, 8 px from the sidebar's edge and right after **Hide sidebar**, with the tooltips "Go back
  (⌘[)" and "Go forward (⌘])". While the sidebar is hidden, they follow **Show sidebar** in the
  view's header, before the **Needs you** total, and a `line` rule separates that group from the
  view's own header. Each is disabled at its end of the history. The history holds the screens you
  visited: a project's board, a ticket and its tab, a session, Add project or Edit project, Usage,
  and Settings. Moving to a screen after going back drops the forward steps, and moving to the
  screen just before this one, as a view's own **Back** does, goes back a step instead; switching tabs in a ticket updates
  its step instead of adding one, opening a ticket's sidebar row included; and a step whose project, ticket, or session is gone, an ended
  session included, or that matches the screen you're on, is skipped. Command-[ and Command-],
  matched on the typed bracket so Option may be held as on a Norwegian layout, the mouse's side
  buttons, and a left or right swipe, the gesture Logi Options+ sends for Back and Forward, do the same, in a terminal too, where Claude Code never gets Command
  keys, but not while a dialog is open.
- **Narrow widths.** The window is at least 760 px wide, with or without the sidebar. The sidebar
  draws at most `100vw - 568px` wide, so the panel is never narrower than 560 px; the width you
  set comes back when the window widens, and dragging the edge or pressing an arrow key starts
  from the drawn width; hiding the sidebar moves it by its drawn width. Every
  view works from a 560 px panel up with no clipped controls, overlapping text, or sideways page
  scroll; the board's columns and the **Sessions** strip scroll sideways inside the panel. Views
  collapse by the panel's width, not the window's, at three breakpoints, in this order:
  - **Under 1152 px:** a live worktree session's **End session** and **End session and remove
    worktree** fold into a ghost 28 px **More actions** button (`Ellipsis`) with a menu aligned to
    its right edge. The view of a session without a ticket shows **More actions** at every width
    while the session isn't removed, for **Save as routine**, and folded actions go above it in
    the same menu.
  - **Under 900 px:** a session's [Gauges panel](#gauges-panel) folds into the **Context** button
    in the header of the session view and of the ticket view, on every tab.
  - **Under 768 px:** a single outline action (**End session**, **Remove worktree**, or **Remove
    from list**) folds the same way, and **Resume** stays a button. **Clear Needs you** becomes a
    ghost 20 px `CirclePause` icon button with the tooltip and name "Clear Needs you for <name>"
    in the session view and "Clear Needs you" in the ticket view, and **Raise cap** likewise
    becomes a `ChevronsUp` icon button, "Raise cap for <name>" or "Raise cap"; the ticket's Blocked by chips become one chip, "2 blockers", whose tooltip lists
    them; and the tab row's "⌘\
    to switch" hint hides.
  - The session's state chip keeps its word at every width in the views (the sidebar's narrower
    rows show its icon, see the sidebar's session list), and the board header's project name
    keeps at least 64 px with its icon.
- The sidebar is 224 px wide by default, and 180 to 400 px when you resize it. An 8 px
  **Resize sidebar** separator straddles its trailing edge with the `col-resize` cursor. On hover a
  2 px `line-2` line shows down its middle, and with keyboard focus the line is `ring`; the line
  shows and hides at once. The line starts and ends 20 px from the window's top and bottom, clear
  of the panel's rounded corners, and fades in over its first and last 28 px. The separator's hit
  area still runs the full height. Dragging it with the primary button sets the width at once, with no
  animation; Left Arrow and Right Arrow change it by 16 px, and a double-click returns it to
  224 px.
- A project sidebar on the left starts with a 28 px **Projects** heading (11 px, weight 500,
  `fg-3`) whose right end holds two ghost 20 px icon buttons: **New group** (`FolderPlus`) and
  **Add project** (a plus). Ungrouped projects follow the heading. Its footer has a ghost 28 px
  icon button with a gear in `fg-2`, labeled **Settings**, with the tooltip "Settings (⌘,)", and
  beside it a matching **Usage** button with a `ChartColumn` icon and the tooltip "Usage". While Sandtable keeps the Mac awake, an 11 px `fg-2`
  line with a 12 px `Coffee` icon reads **Keeping your Mac awake** above them, in a status
  region that screen readers announce.
- While any live session has token use, the footer starts with the **Live now** meter: an 11 px
  `fg-2` block, 8 px side padding and `radius` corners, with **Live now** on the left and the
  compact total and API price estimate on the right ("8.4M · $12.30", tabular figures), over a
  6 px pill bar on `surface-3` split by each session's share of the tokens, 1 px apart. The
  shares cycle through four shades, `fg`, `fg-2`, `fg-3`, and `fg-4`, the same ones as the token
  type bar in **Usage**, in the order the sessions started, so a fifth session repeats the first's
  shade. It counts every live session, including one the sidebar doesn't list, which comes last.
  The total shows its full count on hover. The block takes keyboard focus, with the
  3 px focus ring, and its accessible name is "Live now: 8.4M tokens, $12.30 API estimate", ending
  ", leaves out a model with no price" when the estimate does. Its
  tooltip, 288 px wide and above the block, lists each session on a row: an 8 px dot in its
  shade, the ticket number in mono `fg-3` and the name (truncated), or "Session not on the board"
  for one the sidebar doesn't list, its compact tokens in `fg-3` with the full count on hover,
  and its estimate right-aligned; then "Share of tokens across live sessions. API price estimate,
  not what you paid." in `fg-3`.
- Each project row is 28 px tall and starts with an 18 px tile holding the project's emoji icon
  bare at 15 px, with no fill or ring, or, without one, the first character of the project's name
  (11 px, weight 600, `fg-2` on `neutral-soft` with a `line` inset ring), then
  the name (truncated; weight 500 on the current project), then the **Needs you** count pushed
  right and, while the project is collapsed, its **Running**, **Reviewing**, **Idle**, **Done**,
  and **Done, session open** counts after it, each shown only when it isn't zero. The row is `surface-3` when it's the current page, on hover, while one of its controls
  has keyboard focus, and while its menu is open. Only on hover, keyboard focus, and an open menu
  does the tile turn into a `ChevronRight` button labeled "Show sessions of <name>" or "Hide
  sessions of <name>", which points down while the project is open (at once with reduced
  motion), and a ghost 20 px **More** button with `Ellipsis` ("More for <name>") widen in before
  the count; otherwise **More** is collapsed to no width but still focusable. **More** opens a
  menu with **Edit project** (`Pencil`) and **New session** (plus), a **Routines** submenu
  (`Repeat`), at most 256 px wide, that loads the project's routines as it opens and lists **New
  routine…** (plus) and, after a rule, each routine by name, cut to one line, all opening the [routine editor](#routine-editor), then a **Move to** section
  (an 11 px `fg-3` label, **No group** and each group as radio items with a dot on the current
  one, which does nothing when picked, and **New group…** with `FolderPlus`), then **Move up**
  (`ArrowUp`) and **Move down** (`ArrowDown`), which move the project within its section and are
  dimmed at its ends. The tile button, the name, and **More** are each reachable by Tab and
  Shift+Tab.
- Each group follows the ungrouped projects as its own section, 12 px below the one before: a
  28 px heading styled like **Projects**, with the group name and then a 12 px `ChevronRight`
  that shows on hover and keyboard focus and always while the group is collapsed, pointing down
  while it's open (turning over 150 ms with `ease-out-quart`, at once with reduced motion). Its
  projects sit under it at the same indent as the ungrouped ones. Clicking the name collapses or
  expands the group; a collapsed group shows its projects' total **Needs you** count as the same
  bare count as a project row, and an open one shows none. Moving a project into a collapsed
  group, with **Move to** or a drop, expands it. The current project in a collapsed group stays
  hidden. A **More** button ("More for <name>") widens in before the count like a project row's
  and opens **Rename** (`Pencil`), **Move up**, **Move down**, and a destructive **Delete group**
  (`Trash2`), which moves the group's projects to the end of the ungrouped ones without asking
  and forgets that it was collapsed. An empty group shows a 28 px 11 px `fg-4` line, "Drag
  projects here". **New group**, **Move to > New group…**, and **Rename** show an 11 px name
  field in the heading, selected; Enter or leaving the field saves a name, and Escape or an empty
  name cancels. A new group goes last and starts open.
- Focus stays in the sidebar after a keyboard action: on the project's name after **Move to**,
  on the group's heading after Enter or Escape in a name field (on **New group** when a new group
  is canceled), and on **New group** after **Delete group**.
- A project row or a group heading drags with the pointer after 5 px; the keyboard path is the
  **More** menus. A project drops between projects, onto a group's heading or its "Drag
  projects here" line (the end of that group), or onto **Projects** (the end of the ungrouped
  ones); a group drops between groups. Whether it lands before or after the row under the
  pointer follows the pointer's height against that row's middle. A 2 px `accent` line at the top
  of that row, or under the whole block (a group with its projects, a project with its sessions),
  shows where it lands, and a heading or line a project goes into gets an `accent` inset ring on
  an `accent` 15% fill. A copy of the row (tile and name, or the group name) follows the pointer
  on `raised` with `shadow-md`, and the row itself fades to 40%. A press that starts in a row's
  open **More** menu never drags the row.
  Screen readers hear the moves by name ("Picked up Docs.", "Moved Docs to Work."). The
  groups and the order are saved with the projects; which groups are collapsed is saved for the
  next launch, like the open projects.
- Under each open project, indented 16 px, the sidebar lists its sessions without a ticket and
  its ticket sessions in **Running**, **Needs you**, **Reviewing**, or **Idle**, in one list, oldest first, then
  its ticket sessions in **Done, session open**, oldest first: rows
  like the project rows, each with the session's name (truncated) and its state chip pushed
  right. While the sidebar is under 264 px wide, the chip shows only its icon, keeping the word
  for screen readers, and the row's tooltip, "<name> — <state>", names it. A ticket session's row starts with the ticket number (`#148`, or the Linear or Jira key) in
  mono `fg-3`, 8 px before the ticket's title, and opens the ticket on **Conversation**. A finished
  or ended session and a session whose ticket is off the synced board leave the list; **Leftover
  sessions** lists that last one. On a **Needs you** session, but not **Done, session open** or a
  session stopped at its token cap, a ghost 20 px icon button with `CirclePause`
  ("Clear Needs you for <name>", the ticket's title on a ticket row) widens in after the chip on hover and focus, like **More**, and moves the
  session to **Idle**.
  A live session's tooltip adds its usage, "8.4M tokens · $12.30 API estimate", with "*" after
  the amount when it leaves out a model with no price and the tokens alone when no model has one,
  then, while it's stopped at its token cap, "Reached its token cap" on a line of its own.
  While it has the line, the row
  grows to fit it with 4 px above and below and `radius` corners in place of the pill. The open session's row, or the open ticket's, not the project's, is
  `surface-3` and marked as the current page. A ghost 28 px **New session** with a plus icon, in `fg-2`, ends the list.
  Any number of projects can be open; selecting a project opens it, and the open set is saved
  for the next launch.
- The board has a header with the project's emoji, when it has one, 6 px before the project name, then where its tickets come from in `fg-3` ("Issues from
  <repo>, <repo>", "GitHub Projects board", "Linear team <team>" followed by ", " and the
  chosen Linear projects' names, or "Jira project <key> (<name>)"), the last sync time, **To clean up** while any
  session in any project is left over (see **Leftover sessions** under Settings), an outline 28 px
  icon button labeled **Sync** (`RefreshCw`, turning while it syncs). **Edit project** is in the project's **More** menu in the sidebar. The toolbar
  under the **Sessions** strip is a bar 12 px in from the panel's sides, with a 1 px `line` border,
  `radius-card` corners, and 6 px of padding, and holds the view switcher, **Display**, **Filters**, and **Assignees**, 6 px apart. The
  switcher is a `neutral-soft` pill track with a `line` inset ring and 2 px padding around two 24 px
  icon-only buttons, `SquareKanban` labeled "Board" and `List` labeled "List",
  in `fg-3` (`fg-2` on hover); the pressed one is `raised` with `card-shadow` and `fg`. A view
  switcher is always icon-only with a tooltip and an accessible name. **Display** is a ghost 28 px
  icon button with `ArrowDownUp`, labeled "Display". While the board is grouped, or a sort
  overrides the board's own order, it adds them in `fg-3` after the icon, joined by " · ":
  "Assignee" or "Parent", then the order and an arrow, "Updated ↓". It is labeled then "Display,
  grouped by Assignee, ordered by Updated, descending", leaving out the part that's off.
  It opens a 192 px menu aligned to its left edge: a "Group by" label in 11 px `fg-3`, lined up
  with the item text, then **None**, **Assignee**, and **Parent** as a choice, a rule, an "Order by" label,
  then **Manual** ("Default" on a project without a
  board), **Created**, **Updated**, and **Label** as a choice, a rule, and **Ascending** and
  **Descending** as a choice, which is off under **Manual**. **Group by** is off while a card or row
  is dragged and while the New ticket composer creates or drafts, or shows that an issue was
  created but something after failed; changing it closes an open composer.
  Choosing an order sets its natural
  direction, newest first for times and A to Z for labels, and every choice keeps the menu open. **Label** orders
  by each ticket's first label alphabetically, leaving out `sandtable: in progress`, with unlabeled
  tickets last; ties keep the board's order. **Filters** is a ghost 28 px icon button with
  `ListFilter`, labeled "Filters" ("Filters, 2 checked" while values are checked, counting labels
  and repos together), 6 px after **Display**. In a project with one repo it opens a 224 px menu
  aligned to its left edge: **Show only** and **Hide** as a choice, a rule, one checkable row per
  label with its dot and name, sorted by name, and, while any are checked, a rule and **Clear
  filter**. Choosing a mode or a label keeps the menu open. The menu leaves out
  `sandtable: in progress`, and with no labels it shows "No labels on these tickets". In a project
  with two or more repos the menu holds two submenu rows instead, **Labels** (`Tag`) and **Repos**
  (`BookMarked`), each with the number of its checked values in 11 px `fg-3` while any are checked,
  labeled then "Repos, 1 checked", and a `ChevronRight` in `fg-3` at its right edge. Each opens a 224 px submenu beside it with its
  own **Show only** and **Hide**, a rule, and its rows: **Labels** the label rows above, **Repos**
  one row per project repo by name, then a checked repo the project no longer has, so it can be
  unchecked, then **No repo** on a Linear or Jira project for issues with no repo yet. Repo names match without case. While any value in either is checked, a rule and one **Clear
  filter** below the submenu rows clear both. The repo filter applies only while the project has
  two or more repos.
  **Assignees**, 6 px after **Filters**, is the same button with `UserRound`, labeled "Assignees"
  ("Assignees, 1 checked"), and opens the same menu with **Me** (`CircleUserRound`) and
  **Unassigned** (`CircleDashed`) first, a rule, and then one row per assignee with their avatar
  and name (their login when they have no name), sorted by name. **Me** matches the login signed in
  to the project's ticket source, GitHub, the project's Linear workspace, or its Jira site. Sandtable asks for it
  while **Me** is checked, once per source per launch, again after the next sync if the ask
  fails, and again after **Check again** in the setup guide. A GitHub or Linear call that fails
  makes the next call read the CLI's token again, so a refreshed login takes effect. A 28 px,
  176 px wide search field, labeled "Search tickets" with that placeholder in `fg-4` and 11 px
  text, sits 6 px after **Assignees**. While it holds text, a ghost `icon-xs` **Clear search**
  button with `X` in `fg-3` sits inside its end; it and Esc empty the field. "<n> hidden by
  filter" in 11 px `fg-3` sits 6 px after the search field while any filter or the search hides
  tickets; a ticket shows only when it passes the label, repo, and assignee filters and the
  search.
  Under the header sits one message line in `danger` on `danger-soft`, with a ghost **Dismiss**
  button: the last sync's error, "Started, but couldn't set In Progress: <message>", "Couldn't
  move #<number>: <reason>", "The board has more than 1,000 <open items | recently done items |
  recently closed items not in its done Status>; Sandtable shows the first 1,000.", one for each
  kind that's cut, or that a repo has more than 1,000 open issues, or more than 1,000
  recently closed or updated issues, and the board shows the 1,000 most recently updated,
  or that a Linear team or Jira project has more than 1,000 open or recently done issues and the
  board shows the 1,000 most recently updated. A Jira project's sync can also say "Couldn't read
  the merged pull requests of <repo>: <reason>" or "<repo> has more than 500 merged pull requests
  since <date>, so Sandtable didn't mark merges this sync.", and still marks the merges it found.
  With a board, it can say "The Jira board's backlog has more than 1,000 issues; Sandtable hides
  the first 1,000 and may show the rest in To do." or "The Jira board <name> no longer exists;
  edit the project to pick another.", which hides nothing.
  **To clean up** shows only while one or more sessions or worktrees are left over, a state that
  needs you, so it's a 28 px button in `danger` on `danger-soft` (`danger` at 15% on hover, 25% in dark)
  with no words: a `BrushCleaning` icon and the count in a small badge with a 1 px `danger` inset
  ring at 30%. Its accessible name and tooltip are "<n> sessions to clean up" ("1 session to clean
  up"). It opens a side panel from the window's right edge: 420 px wide, full height, `raised` with
  `shadow-lg`, over a transparent overlay so the board stays in view. The panel's 44 px header, with
  a `line` rule under it, holds the title **To clean up**, **Clean up all** when it applies, and a
  ghost icon **Close**. Under it, the lede and the same rows as Settings scroll, with every leftover
  of every project, each row naming its project, in the same one-line-per-fact layout that fits
  420 px. The panel keeps focus inside, closes on Escape, an outside click, or **Close**, and
  stays open when the last row goes; while **Clean up all** or a row's action runs, it doesn't close
  and **Close** is disabled. The count reloads when it closes. The [Routines
  section](#routines-section) follows, with 12 px padding, 4 px at the top. A **Sessions** strip
  comes next, even when the project has no sessions without a ticket, with 12 px padding, none at
  the top, and no rule under it:
  the 11 px `fg-2` heading "Sessions" with the count in `fg-3`, "0" included, then a row of session
  cards 8 px apart, oldest first, that scrolls sideways and leaves room for the focus ring. **New
  session** ends the row: a placeholder styled like **New ticket**, 240 px wide and at least 91 px
  tall, a session card's height, so the strip keeps its height when a session starts or ends. It
  opens the New session dialog, and its tooltip reads "Start a Claude Code session that isn't tied to a ticket". Then the toolbar row, and, in the board view, three 350 px columns,
  each heading starting with its status icon: **To do**, **In progress**, **Done**. **New ticket**
  ends the **To do** column's cards: a placeholder in a card's place, at least 56 px tall,
  with `radius-card` corners, a 1 px dashed `line-2` border, no fill, and a centered 14 px plus and
  "New ticket" in `fg-3`. On hover it takes the `card` fill, a `fg-4` border, and `fg-2` text.

## Cards

- A card is a column with 6 px gaps and 12 px padding, laid out like a Linear card:
  - On a sub-issue, the parent line first, 11 px in `fg-3` (`fg-2` on hover): a 12 px
    `CornerUpRight` arrow, the parent's key in monospace, and its title, cut off with an
    ellipsis, with the full title on hover; a parent that isn't on the board ends with a 12 px
    external-link icon. Screen readers hear "Sub-issue of <key> <title>".
  - The top row, 11 px in `fg-3`: the monospace `#number` (for a Linear or Jira issue, its key,
    such as `ENG-12`; the same goes wherever this doc writes `#<n>` or `#<number>` for a ticket),
    and the repo (none on a Linear or Jira issue whose repo isn't known yet). On the right,
    **Merged** on a ticket in **Done** that a merged pull request closed, a Linear issue with one
    attached, or a Jira issue whose key one names (see the ticket view), or, on a ticket in another column with an open pull request,
    where it stands (**PR open**, **Conflicts**, **Checks failing**, **Changes requested**, or **Ready to merge**,
    in the [pull request stage chip](#color)), then the session's model while the state chip shows (**Fable**, **Opus**, **Sonnet**, or **Haiku** in 11 px
    `fg-3`, which screen readers hear as "Model: Opus"; nothing for Account default), then the state chip, then the assignees as 18 px round avatars with their initial (`line-2` fill,
    `fg` text, a 1 px ring in the card's fill so they overlap cleanly), named in a Tip tooltip on hover by their
    name, or else their GitHub login or Linear or Jira display name. Past two, "+N" follows and names the rest in a Tip tooltip on hover.
    The repo is cut off with an ellipsis, with the full `owner/name` on hover. When the row doesn't
    fit the card, the group on the right wraps onto a second line, 4 px under the first and kept to
    the right, so nothing sticks out past the card's edge.
  - The title in `fg`, at most two lines, cut off with an ellipsis. `inline code` in a title is
    monospace in a 1 px `line` box.
  - Property chips, 10 px under the title, wrapping onto more rows: 20 px pills with a 1 px `line`
    border and 11 px `fg-2` text, in this order: **Blocked by #n** for each open blocker (with the
    repo before the number for another repo, and the blocker's title on hover), sub-issue progress
    ("3/6 sub-issues" with a 12 px ring, its track `line-2` and its arc `fg-2`, then a 12 px
    `ChevronRight` that points down while the list is open; on hover the chip takes
    a `line-2` border and the `surface-3` fill), the labels (an 8 px
    color dot and the name), and, for a board project, the board's other single-select fields that
    have a value, as the value with "<field>: <value>" on hover; for a Linear or Jira issue, a **Status**
    field with its status name when it isn't the column's name, such as "In Review". A long name
    is cut off inside its
    chip.
  - With the progress chip open, the parent's sub-issue list, 6 px under the chips and reaching
    4 px into the card's padding on each side: `radius` corners, a `surface-2` fill, a 1 px
    `line` inset ring, and 4 px of padding around 28 px rows with `radius` corners and no
    dividers, `surface-3` on hover. Each row has the status icon, the monospace key, the title cut
    off with an ellipsis, and, while that sub-issue has a session, its state chip. It opens with a
    200 ms `ease-out-cubic` fade and 6 px drop, a fade alone with reduced motion. When GitHub listed only some, a last row reads
    "N more on GitHub".
  - On a **Running** card, but not **Done, session open**, the **activity strip**: what the
    session's Claude Code is doing, read from the tail of its conversation file every 3 s. It's a
    28 px row reaching 4 px into the card's padding on each side, 10 px under what's above it,
    with `radius` corners, a
    `surface-2` fill, and a 1 px `line` inset ring, in 11 px `fg-2`: a
    12 px icon in `blue` for the kind of step (`Pencil` for an edit, `SquareTerminal` for a
    command, `FileText` for a read, `Search` for a search, `Globe` for a fetch, `Bot` for an
    agent, `Sparkles` for a skill, `Wrench` for any other tool), the verb ("Editing", "Running",
    "Reading", "Searching", "Fetching", "Asking an agent", "Using", or the tool's own name) and
    its target in monospace (a path without the session's folder, a command without a leading
    `cd <session folder>` and its `;` or `&&`, a pattern),
    cut off with an ellipsis; then, in `fg-3`, how long since the current turn's prompt ("under
    1m", "4m", "2h", "1d 2h", none when the prompt is out of reach). With only one step it's
    plain text, read as "Running npm test, for 4 minutes". With earlier steps it's a button,
    `surface-3` on hover, with the step shown whole on hover and a 12 px `ChevronRight` in `fg-3`
    last. Its accessible name is the step and time in words, such as "Running npm test, for 4
    minutes. Show last steps", and it's `aria-expanded`. Clicking it, or Enter or Space, opens
    the last steps under it in place, the latest included, up to five one-line rows in 11 px `fg-3`
    with each step's icon, its words cut off with an ellipsis and shown whole on hover, and how
    long ago it was ("just now", "3m ago");
    the chevron points down while they show. It never opens the card. The state chip stays: the
    strip adds to **Running**, it doesn't replace it. With no steps yet, there's no strip.
  - The usage row, 11 px in `fg-2` with tabular figures: the tokens on the left ("32M tokens",
    the full count on hover) and the API price estimate on the right ("$18.88"), marked with "*"
    when it leaves out a model with no price and left out when no model has one; screen readers
    hear "API estimate" after it. A card in **Done** shows the ticket's usage, which loads once
    when the card shows and again when the ticket's newest session changes. Any other card with
    a live session shows that session's usage, which updates every 3 s. When the project has a
    **Token cap**, the left side reads "8.4M of 25M cap" and a 4 px pill meter on `surface-3`
    follows, filled in `fg-3` to the share of the cap used, named "34% of its token cap". Once
    the session reaches its cap, the fill is `amber` and "Reached its token cap" follows in
    `amber`. Nothing shows while usage loads, with no tokens, or when it fails.
  - The footer, 11 px in `fg-3`: "Created Oct 12 Updated Oct 23", each date with its full date
    and time on hover.
  - Then the result line and the action row, when the card has them.
- A card has no colored edge; its state is the chip's icon and word. A card with no session has
  no state chip, and neither does a card or list row in **Done** whose session is **Finished**: on
  a card, **Remove worktree** already says so, and **To clean up** lists the worktree while it's
  on disk.
- Cards don't show the `sandtable: in progress` label. The **In progress** column already says
  it; the label is a marker on GitHub.
- The whole card opens the ticket view: a click anywhere, or Enter while the card has focus.
  Every card is in the tab order with the focus ring, and its fill steps up from `card` to
  `card-hover` on hover and to `raised` while you press and hold it, the fill its dragged copy
  keeps (at once, fading back over 150 ms). Pressing a button, a link, or the note's text area inside the card doesn't change it.
  Buttons inside a card keep their own action and don't open the view.
- The parent line and a sub-issue row jump to that ticket's card: it scrolls into view, takes
  focus, and rises 6 px and fades in over 200 ms as a card does when its state changes, while its
  fill steps to `card-hover` and fades back to `card` over 150 ms ease-out. Of a ticket with a card
  in more than one assignee lane, the copy in the lane you jump from wins. No accent ring. A ticket on
  the board whose card isn't shown, such as one hidden by a filter or in a collapsed lane, opens
  its ticket view instead, and one that isn't on the board opens on GitHub, in Linear, or in Jira.
- The action row holds at most one 20 px button, then the Remote Control mark; **Start** also
  has the model chip and **Start with…** after it:
  - **Start** on a ticket with no session, or whose worktree was removed, that isn't done. **Start**
    first runs the [Start check](#start-check-dialog), then opens the Start dialog when the
    project has more than one repo or the ticket has none. Its title is "Start <#n> <title>" and
    its description "Runs Claude Code in a new worktree of <repo>." For a Linear or Jira issue with no
    repo it first asks **Repo for the worktree**, a radio box per project repo with none chosen
    (the description reads "Choose the repo the worktree goes in." and **Start** is disabled
    until one is), unless the project has one repo, which it uses without asking. Then **Extra
    repos (optional)** offers the project's other repos as checkboxes, pre-checked with the
    extra repos of the ticket's newest session; it's left out when there are none and until a repo
    for the worktree is chosen. Then it runs the [readiness check](#readiness-check) and the
    [overlap check](#overlap-check) on the card; then
    the folder check and the start run together, and the button reads "Starting" and is disabled. **Choose
    folder…** reads "Checking folder" while it works.
  - The **model chip**, after **Start**: a 20 px pill on `fg` at 5% (8% on hover and while open)
    with the model's name in 11 px `fg-2` (`fg` on hover) and a 12 px chevron, named "Model: <name>". It shows the
    model Start will use, the project's until you pick another. Its menu, "Model for this
    session", lists Account default, Fable, Opus, Sonnet, and Haiku as radio items, the project's marked
    **Project** in `fg-3` on the right. The pick belongs to the ticket, so the card and the ticket
    view show the same one; it applies to **Start**, **Start with note**, and **Start with planning**, and it's forgotten once
    the session starts. In the ticket view the chip is 28 px tall.
  - **Start with…**, a 20 px ghost button in `fg-2` with a 12 px chevron after the model chip,
    opens a menu of two items. **Start with note** turns the action row into the
    [note composer](#start-note-composer). **Start with planning** runs the same checks as
    **Start**, then starts Claude Code in plan mode.
  - **Resume** on a **Finished** ticket that isn't done ("Resuming" while it works).
  - **Remove worktree** on a **Finished** ticket in **Done** ("Removing").
  - **End session and remove worktree** on a **Done, session open** ticket ("Ending session").
  - **Session elsewhere:** when the ticket has no live session of its own but another project over
    the same GitHub, Linear workspace, or Jira site has one (a Linear project with no saved
    workspace uses the CLI's default one, so it matches any workspace), the newest such session shows as one
    row button in place of **Start**, the model chip, **Start with…**, and **Resume** (a
    finished session's **Remove worktree** stays): reaching 4 px into the card's padding on each
    side, `radius` corners, a `surface-2` fill (`surface-3` on hover), a 1 px `line` inset ring,
    and 11 px text: the other project's tile and name, cut off with an ellipsis, its state chip
    (**Done, session open** while the ticket is in **Done** on this board), and "Open" with a
    12 px `ChevronRight` in `fg-3`. Its accessible name reads "<state> in <project>. Open the
    session", such as "Running in Web. Open the session". It opens the ticket's **Conversation** in
    that project, not this card. The card's top row shows no state chip for it.
  - **Running**, **Needs you**, **Reviewing**, and **Idle** cards have no action button; the card itself opens
    the ticket on **Conversation**. A **Needs you** card shows only **Clear Needs you** after the
    mark, or **Raise cap** while it's stopped at its token cap.
  - A card whose session isn't removed and has Remote Control on shows a 14 px `fg-3` radio tower
    icon, focusable, an image named "Remote Control on" by its **Tip**. It's a status mark, not a
    button; the switch is in the [Gauges panel](#gauges-panel).
  - A **Needs you** card, but not **Done, session open**, has **Clear Needs you** after the
    mark, when it shows, a 20 px outline button that moves the session to **Idle** without opening the card.
  - A card whose session is stopped at its token cap has **Raise cap** after the mark in place
    of **Clear Needs you**, a 20 px outline button that lets the session use another cap's worth of
    tokens.
- **Done, session open** replaces **Running**, **Needs you**, **Reviewing**, and **Idle** on any card in **Done**
  whose session is still open. The sidebar's **Needs you** count leaves it out; the sidebar's
  session rows list it after the live ones.
- **Can't start:** when **Start** finds the folder gone or its remote changed, the card shows
  **Can't start**, the line "Couldn't start: <reason>. Nothing was created."
  in `danger`, and **Choose folder…**, which opens the macOS folder dialog. The ticket view shows
  the same chip in its header, the line in its `danger` strip, and **Choose folder…** in place of
  **Start**. The failure stays with the ticket, so it shows wherever you are when the start fails.
  A folder that passes the check clears the state on every ticket from that repo; one that fails
  shows the check's error in the same line.
- Results show as an 11 px line above the action row. "Session ended and worktree removed" and
  "Worktree removed" are `fg-2` and clear after 3.5 s. "Session ended. Kept the worktree:
  <reason>" and "Couldn't remove the worktree: <reason>" are `danger` and stay; after the first,
  the card loses its chip and shows **Remove worktree**.
- While a session is live, a fetch that failed at **Start** shows as "Couldn't update <repo> from
  GitHub, so this branch starts from your local copy: <reason>" in `danger` in the same line. A
  session whose `claude` exited within 10 s of its launch shows "Claude exited right after it
  started. Run claude in the session's folder to see why." there in `danger` until it's resumed or its
  worktree is removed. A session with no `SessionStart` 30 s after its launch shows "Claude Code
  hasn't started. It's probably waiting for you to trust this folder: open the terminal to answer
  it." there in `danger` until Claude Code starts or the session ends.
- A session card, in the **Sessions** strip, is 240 px wide with a ticket card's shape, hover,
  and focus: the session's name (truncated) with the session's model and the state chip pushed right, then, in `fg-2`,
  the repo and "main checkout" or the branch in monospace, then, while **Running**, the activity
  strip, which makes the card that much taller than its neighbors in the strip, then a live
  session's usage row, as on a ticket card. Under them, a refusal in an 11 px
  `danger` line, then the card's Remote Control mark while it's on and the session isn't removed and, on
  **Needs you**, **Clear Needs you**, or **Raise cap** while it's stopped at its token cap. After the state chip, an icon-only X with a **Tip**, **End
  session** or, for a finished session, **Remove session**, shows while you hover over the card or
  while anything in the card has focus. It opens a confirmation with **Cancel** and **End session and
  remove worktree** or **End session and remove** (main checkout); for a finished session,
  **Remove worktree** or **Remove from list**, all destructive. Confirming ends the session when it's live, then
  removes the worktree or list entry, as the session view's buttons do; a kept worktree's reason
  shows in the `danger` line. The card has no other
  button and doesn't drag; a click, or Enter or Space while it has focus, opens the session view.
- A ticket or session card whose state changes rises 6 px and fades in over 200 ms with
  `ease-out-cubic`; with reduced motion it only fades. A ticket card also rises when a sync brings
  a change from GitHub, Linear, or Jira, so under **Updated** its jump to the top of the column shows.

### Start check dialog

- **Start**, on a card or in the ticket view, opens the check before the Start dialog. It uses the
  same dialog layout as the Start dialog, and each step has its own title, with **Cancel**
  (outline) on the left of the footer:
  - "Checking #<n>…", shown only while it checks again after **Apply**. A first check that finds
    nothing shows no dialog.
  - "Asking Claude for the area and blockers…" on a ticket without an `area:` label, saying that
    Claude reads the repo but can't change it, and that it can take up to 3 minutes. **Cancel**
    closes the dialog, and the result is dropped when it arrives.
  - "Claude's triage of #<n>": **Area** in monospace, **New area labels** (only when there are
    any), **Blocked by** as "#<n> <title>" rows (a Linear or Jira issue shows its key) or "None",
    then Claude's reason in `fg-2`. The body opens with "Apply writes these to GitHub. Until then,
    nothing on GitHub changes.", naming Linear or Jira in a Linear or Jira project. Section
    headings are 11 px, weight 500, in `fg-2`. Any problems the first check found come first, as
    bullets. **Start anyway** (outline) starts without applying, and **Apply** ("Applying" while
    it works) writes the triage to GitHub, Linear, or Jira and checks again.
  - "Couldn't triage #<n>", "Couldn't check #<n>", or "Couldn't apply the triage", with the error
    in `danger`, any problems the first check found under it, and **Start anyway**. Every failure
    keeps those problems, including a failed **Apply** and a failed check after it.
  - The title and body sit in a `status` region, so a screen reader announces each step.
  - "Start #<n> anyway?", with each problem as a bullet and **Start anyway**.

### Readiness check

- After the Start check and the repo picker, and before the overlap check, Claude reads the
  ticket's title, text, and comments and the repo, read-only with the project's account, and lists
  what's missing: what to change, why, and how you'd tell it's done, or what the issue format in
  the repo's `CLAUDE.md` asks for. It sits where the overlap check does, on the card and in the
  ticket view, belongs to the ticket the same way, and uses its sizes, buttons, and `status`
  region. It doesn't run when the project's **Readiness check** is off, or when the ticket's title
  and text haven't changed since a check that passed while Sandtable was open.
  - Waiting: a 12 px spinner and "Checking whether the ticket is ready" in 11 px `fg-2`, then the
    disabled **Checking** and **Cancel**.
  - A ready ticket goes on to the overlap check with no other step.
  - **Not ready**: the words in an `amber` chip on `amber-soft`, then each gap as a bullet in
    `fg-2`, then **Refine in chat** (outline), **Start with planning** (outline), **Start anyway** (outline), and **Cancel** (ghost).
    The buttons wrap onto a second line when they don't fit the card.
    **Refine in chat** clears the block, opens the ticket view on **Details** with the chat panel
    shown, and sends the gaps there as your message. **Start with planning** goes on to the
    overlap check and then starts in plan mode. **Start anyway** goes on to the overlap check.
  - Failure, including the 3-minute timeout: the error in `danger`, then **Start anyway** and
    **Cancel**. A missing repo folder goes straight to the start, as in the overlap check.

### Overlap check

- After the Start check, the repo picker, and the readiness check, when the check found tickets in the same repo with
  the same `area:` label in **In progress** or with a live or starting session whose ticket isn't
  done, Claude reads them
  and the repo code, read-only, and keeps only those that really overlap. With no such tickets,
  Claude isn't asked and nothing shows. On a card it sits above the action row and takes the place
  of the action button; in the ticket view it sits in the strip under the header, with 16 px side
  padding, and the ticket view's **Start** is disabled. Clicks inside it don't open the ticket. The
  check belongs to the ticket, not the card: it survives a sync moving the card, a drag, the list
  view, and opening the ticket view or going back, and the card and the view show the same block.
  - Waiting: a 12 px spinner and "Checking overlap with #67 and #91" in 11 px `fg-2`, then a
    disabled 20 px outline **Checking** and a 20 px ghost **Cancel**. **Cancel** drops the result;
    the Claude run still finishes in the background, and a new **Start** never gets its answer.
  - With no overlap, the session starts with no warning, with the repos you picked.
  - **Overlaps**: the word in an `amber` chip on `amber-soft`, then "#<n> <reason>" per
    overlapping ticket in `fg-2`, the number in monospace, then **Start anyway** (outline) and
    **Cancel** (ghost). Tickets Claude cleared aren't listed.
  - Failure: the error in `danger`, then "By area label: #67 and #91 are in progress in area:
    board." in `fg-2` ("in the same area." when the ticket has no area label any more), and the
    same two buttons. A missing repo folder skips this and goes straight to the start, so a card shows **Can't start**.
  - The lines sit in a `status` region, so a screen reader announces each step.

### Worktree setup

- After the checks, when a repo has a worktree setup and Sandtable just made its worktree, or its
  setup didn't finish, Sandtable copies the paths and runs the command before `claude` starts. The
  block sits under the overlap check's place, on the card and in the ticket view, belongs to the
  ticket the same way, and uses its sizes and `status` region; while it shows, the card's action
  row is hidden and the ticket view's **Start** is disabled. The [New session
  dialog](#new-session-dialog) shows the same block above its footer.
  - Running: a 12 px spinner and "Setting up the worktree: <command>" in 11 px `fg-2`, the
    command in monospace, or "Copying files into the worktree" when the repo has no command;
    with " for <repo>" after "worktree" when the project has more than one repo. Then each
    skipped path's note, such as "Skipped .env.local: not in the main checkout", in `fg-3`. Then
    the activity strip's inset row: the latest output line in monospace, truncated, with the time
    since setup started in `fg-3`; before any output, "Waiting for output" in `fg-3`, and with no
    command no strip until a line comes. With two or more lines, the row opens the last 10 lines
    in place, as the activity strip opens its steps. Then a ghost **Cancel**, which stops the
    command and its children; a ticket keeps its worktree for the next **Start**, and the [New
    session dialog](#new-session-dialog) removes its worktree if it's clean.
  - Failed, including the 10-minute timeout: "Setup failed: npm install exited with code 1",
    naming the command when it's one line of at most 40 characters and "the setup command"
    otherwise, or "Setup failed: timed out after 10 minutes", in `danger`, the notes, and the strip open on the
    last lines, then **Start anyway** (outline), which starts `claude` without setup, and
    **Cancel** (ghost). The next **Start** runs the setup again. After a reload, the failed block
    offers only **Cancel**. Once you click **Start anyway**, the block goes until that start
    ends, so it can't start twice; either button puts focus back on the card, or on the ticket view's title.
- The first **Start** from a card in a repo with no setup, while Sandtable runs, once the
  readiness and overlap checks pass, checks for a [setup
  suggestion](#add-project) without holding up the start. When there is one, the card shows a hint
  under the setup block's place, until you answer it: the same inset shell and lightbulb, with
  "New worktrees here won't have .env or node_modules" in 11 px `fg-2`, naming the copied paths
  and the folders the command builds in monospace, or "New worktrees here won't run bundle
  install" when there's no such folder, in a `status` region. Under it, two text links: **Set
  up** (`fg`), which opens **Edit project** at the **Repos** step, and **Not now** (weight 400,
  `fg-3`), which hides the hint for that repo for good and puts focus back on the card. A repo
  that gets a setup drops the hint. A **Start** from the ticket view doesn't check.

### Start note composer

- **Start with note**, in the **Start with…** menu on a card or in the ticket view, puts a form named "Start with note" in
  place of the buttons, in the [New ticket composer](#new-ticket-composer)'s field, with its fill,
  ring, padding, and entrance: one borderless three-line text area, "Note for this session", with
  the placeholder "Add a note for this session…" in `fg-4`, which takes focus and grows with its
  text up to 240 px; then a footer with "Esc to cancel · ⌘↩ to start" in 11 px `fg-3` and a
  primary 28 px **Start**, which reads **Start with note** once the note has more than spaces.
- Enter adds a line. **Start** or ⌘↩ runs the same Start as **Start**: the Start check, the Start
  dialog when it's needed, and the readiness and overlap checks, and the trimmed note, cut to 4,000 bytes, starts
  the session's opening prompt, before the issue line. A blank note starts as **Start** does. The note isn't saved, so
  **Resume** doesn't send it again.
- Escape closes it, drops the note, and focuses **Start with…**; during an IME composition it
  only ends the composition. Its **Start** closes it the same way but keeps the note, so focus
  comes back to **Start with…** when the dialog closes, and cancelling the Start check, the
  Start dialog, or the readiness or overlap check, or a start that fails, leaves the note there when you open
  it again. The note clears once a start succeeds. In the ticket view, the note stays when you
  switch tabs. When **Start** is no longer offered, it closes, and if it had focus, focus moves
  to the card, or in the ticket view to the selected tab. After a **Start with planning**, focus returns to **Start with…** the same way when its Start check or dialog closes. A Start whose check or dialog is still
  open is dropped when the ticket can't start any more, such as when a sync removes it. Clicks,
  presses, and keys inside it don't open the card or start a drag.

### Drag and drop

- Any card drags to any column. A drag starts after the pointer moves 5 px, so a click still opens
  the ticket. With the keyboard, Space on a focused card picks it up, Left and Right Arrow
  choose a column, Space drops it, and Escape cancels; Enter still opens the ticket, and
  Space on a button inside the card stays the button's. Releasing the pointer outside every column
  cancels the drag.
- While dragging, the card's place goes empty (opacity 0) and a copy follows the pointer with
  the `raised` fill and `shadow-md`. The column under the copy gains a 1 px inset `line-2` ring that
  follows its `radius-card` corners.
- Dragging sets no order within a column, so nothing in a column makes room while you drag; a
  dropped card takes its place in the column's order, the **Display** order or the source's order (GitHub's, Linear's, or Jira's).
- Grouped by assignee, any card drags to any lane's cell, and a drop in another lane changes the
  assignee as well as the status; see [Swimlanes](#swimlanes). With the keyboard, Left and Right
  Arrow choose the column and Up and Down Arrow the lane.
- Grouped by parent, a card drags only within its lane's cells, and a drop changes only its
  status. Another lane's cells, counts, and header don't take the drop or ring, so a collapsed
  lane doesn't open during the drag. With the keyboard, Left and Right Arrow choose the column,
  and Up and Down Arrow (in the list, the status group) stay in the lane.
- The card shows in its new column and lane at once. While its move is in flight it can't be dragged
  again. A failed move puts it back and shows "Couldn't move #<number>: <reason>" in the board's
  error line. A failed move keeps what it already wrote: the status writes first, and when the
  assignee write fails after it, only the lane goes back. When GitHub added the new person but
  couldn't remove the old one, Sandtable syncs and the card shows in both lanes.
- After a drop in a lane, focus moves once to the card in the lane it landed in, or to that
  lane's header when the lane is collapsed. A drop on **No assignee** that leaves the ticket other
  assignees focuses its card in the first of their lanes, in the same column. When the move fails
  and focus was on the card or nowhere, focus returns to the card where it went back. Focus
  moves only then, so a later sync, view switch, or opened lane never takes it.
- A keyboard drag targets the drop zone under the center of the dragged card, so a card centered
  on a small count isn't taken by a neighbouring count it covers.
- A screen reader hears the instructions "To move a ticket, press Space, then Left or Right Arrow
  to choose a column, and Space again to drop it. Press Escape to cancel.", then the steps
  "Picked up #<number>.", "Over <column>.", and "Moved #<number> to <column>." or "#<number>
  stays in <column>."; Escape gives "Move canceled. #<number> stays in <column>." Grouped by
  assignee, the instructions say "Left or Right Arrow to choose a column and Up or Down Arrow to
  choose a lane", and each place is "<lane>, <column>": "Over <lane>, <column>.", "Moved #<number>
  to <lane>, <column>.", and "#<number> stays in <lane>, <column>.". A drop on **No assignee**
  that leaves the ticket other assignees gives "Removed <name> from #<number>.", or "Removed
  <name> from #<number> and moved it to <column>." when the column changes too. Grouped by
  parent, the instructions stay as without lanes, and each place is "<lane>, <column>", the lane
  named "#<number> <title>".

### List view

- **List** on the switcher shows the same tickets as rows, grouped by status in the board's
  column order: **To do**, **In progress**, **Done**. **Display** orders the rows within each group
  and **Filters** and **Assignees** filter them, as on the board. Each project remembers its view and its collapsed
  groups across restarts.
- The list scrolls with 8 px at its sides. Each group starts with a header that sticks to the top
  while its rows scroll: a 36 px button with `radius` corners, 8 px above it, holding a 14 px
  `ChevronRight` in `fg-3` that points down while the group is open, the status icon, the title in
  11 px weight 500 `fg-2`, and the count in `fg-3`. Its fill is the status color at 8% over
  `panel`, flat: `fg-3` for **To do**, `yellow` for **In progress**, `accent` for **Done**. The
  header is `aria-expanded`; clicking it collapses the group to its header, which keeps the count.
- A row is 36 px tall, padded 30 px on the left so its number starts under the header's status
  icon: `#<n>` in 11 px monospace `fg-3` in a 36 px column (64 px for a Linear or Jira key, cut off with an ellipsis and shown whole on hover), the title truncated to one line, then, on a **Running** row, the
  **activity pill**: at most 25% of the row, a 22 px pill with a `surface-2` fill and a 1 px
  `line` inset ring holding the activity strip's icon, words, and time in 11 px, with no
  chevron. It's focusable with the step and time as its accessible name, and its tooltip, on
  hover or focus, lists "Last steps": the last five, newest in `fg` and the rest in `fg-3`, each
  with how long ago it was. Clicking it or pressing a key on it doesn't open the row. Then the labels in the
  card's pills (without `sandtable: in progress`), which take at most 40% of the row, so beside
  the pill the title keeps its room, the card's pull request stage chip outside **Done**, the state chip with its word, another project's [session elsewhere](#cards) as its state chip and "in <project>" in 11 px `fg-3`, cut off with an ellipsis at 160 px, and the updated date ("Oct 26") in 11 px `fg-3`,
  with the full time on hover. A `line` rule separates rows; a hovered row is `surface-3` with
  `radius` corners, fading out like other highlights. Rows have no buttons: clicking a row or
  pressing Enter on it opens the ticket, where **Start** and the rest live. A row that takes
  keyboard focus scrolls clear of the sticky header.
- **New ticket** ends the **To do** group as a row in the same shape, a 14 px plus and "New
  ticket" in `fg-3` (`fg-2` on hover), and turns into the same composer as on the board. A
  collapsed **To do** hides it too, and collapsing **To do** or switching views closes an open
  composer. While the composer creates or drafts, or shows that an issue was created but something
  after failed, the view switcher and the **To do** header are disabled, so the composer stays
  until you close it.
- Rows drag like cards, to any group, with the same rules and the same move. While dragging, the
  row's place goes empty and a copy of the row follows the pointer on `raised` with `shadow-md`;
  the header of the group under it gains a 1 px inset `line-2` ring. A collapsed group still takes
  a drop on its header, and a row dropped there by keyboard leaves focus on that header. With the
  keyboard, Space picks a focused row up, Up and Down Arrow choose a group, Space drops it, and
  Escape cancels. While a row is dragged, the view switcher and the group headers are disabled.
  The groups are measured again every 100 ms during a drag, so a group that shifts, under a new
  error line or a failed move snapping back, still takes the drop under the pointer.
- A screen reader hears "To move a ticket, press Space, then Up or Down Arrow to choose a group,
  and Space again to drop it. Press Escape to cancel.", then the same steps as on the board, with
  the group names.
- Grouped by assignee, the list holds one group per [lane](#swimlanes), in the lanes' order. Its
  header is the same 36 px sticky button on `surface-3`, holding the chevron, the lane's avatar,
  its name, and its ticket count in `fg-3`. An open lane shows a 28 px subheader per status, **To
  do**, **In progress**, and **Done**, each with its status icon, title, and count in 11 px weight
  500 `fg-3`, padded 30 px on the left, then its rows. Each status subgroup takes a drop and gains
  the 1 px inset `line-2` ring with `radius` corners while a row is over it. A collapsed lane
  takes a drop on its header, which keeps the row's status, and a row dropped there leaves focus
  on that header. With the keyboard, Up and Down Arrow step through each lane's status groups in
  order, a collapsed lane as its header. While a row is dragged, every lane header is disabled.
  **New ticket** ends **No assignee**'s **To do** subgroup, and collapsing **No assignee** closes an
  open composer. Grouped by parent, the list does the same with the parent lanes' headers and
  **No parent** in place of **No assignee**, and Up and Down Arrow stay in the row's lane.

### Swimlanes

- **Display > Group by > Assignee** shows the board as one lane per person with a ticket among the
  shown (filtered) tickets, sorted by name (their login when they have no name), then **No
  assignee**, always last and shown even when empty. A ticket with several assignees shows in each
  of their lanes. Each cell keeps the **Display** order.
- The lanes scroll together, both ways, with 12 px at the sides and bottom, 8 px apart. Above them
  a row of the three column headings, each with its status icon, title, and the column's ticket
  count (a ticket in several lanes counts once), sticks to the top on `panel`, in 350 px columns 12 px apart lined up with the lanes'
  cells.
- Each lane is a panel with a 1 px `line` border, `radius-card` corners, and the `panel` fill. Its
  40 px header, 8 px in from the sides, holds a 28 px button with `radius` corners and `surface-3`
  on hover: the chevron, the person's 18 px avatar (an 18 px dashed `fg-4` circle for **No
  assignee**), the name truncated in 11 px weight 500 `fg-2` with the full name on hover, and the
  lane's ticket count in `fg-3`. The button is `aria-expanded` and collapses or opens the lane;
  it's disabled while a card is dragged.
- An open lane shows its three cells, 8 px in from the sides and bottom, each at least 64 px tall
  with 4 px padding and cards 8 px apart. A cell is named "<lane>, <column>" and takes a drop,
  gaining the 1 px inset `line-2` ring on its `radius-card` corners while a card is over it.
- A collapsed lane shrinks to its header, with each column's count lined up under that column: a
  28 px box with `radius` corners holding the status icon and the count in 11 px `fg-3`, heard as
  "2 in progress". Each count takes a drop into that column and gains the same ring. During a
  pointer drag the rest of the header row takes a drop too, keeping the card's column. Holding a
  pointer drag over a collapsed lane for 700 ms rings its panel and opens it; a keyboard drag
  doesn't.
- A drop in another lane changes the assignee. On GitHub it adds the person whose lane the card
  lands in, then removes the person whose lane it left, and other assignees stay; on Linear and
  Jira it replaces the assignee. A drop on **No assignee** removes the person whose lane the card left.
  If removing the old person fails after the add, GitHub keeps both, and the board shows both
  after the sync that follows.
- **New ticket** ends **No assignee**'s **To do** cell. Collapsing **No assignee** closes an open
  composer, and while the composer creates or drafts, or shows that an issue was created but
  something after failed, **No assignee**'s header is disabled.
- Each project remembers its collapsed lanes across restarts, shared by the board and the list.
- **Display > Group by > Parent** uses the same layout with one lane per parent among the shown
  tickets, sorted by number or key (numbers in numeric order), then **No parent**, always last and shown even when empty,
  holding every other ticket and ending with **New ticket**. A parent sits in its own lane, even
  when it is also a sub-issue. A parent lane's header button holds the chevron, the parent's
  status icon, its `#number` or key in monospace `fg-3`, the title truncated in 11 px weight 500
  `fg-2`, and, when its sub-issue count is known and above zero, the card's 12 px progress ring
  and "1/3" in `fg-3`, with no ticket count. It is heard as "#12 Import contacts, In progress,
  1/3 sub-issues done". **No parent** has the dashed `fg-4` circle and its count. A parent that
  isn't on the board heads its lane from the sub-issue's reference: its issue state for the icon
  (closed reads as Done) and the service's sub-issue counts, which Jira doesn't give. On Jira an
  on-board parent's count covers only its subtasks, so an epic shows none. **No parent** takes
  **No assignee**'s place for **New ticket**: collapsing it closes an open composer, and its header
  is disabled while the composer is locked.
- In a parent lane, the parent's card starts its key row with a dashed **Parent** tag (the card's
  chip with a dashed `line-2` border, 6 px padding, and `fg-3` text), and its list row has the
  tag before the title. The other cards in a lane leave out the parent line; the parent's own
  card keeps its line when it is a sub-issue too. The dragged copy matches the card it came from.

## Ticket view

- The ticket view keeps the sidebar. Its header has **Back to board** (a ghost 28 px icon button
  with a back arrow), the monospace `#number` in `fg-2`, the title (truncated), a **Blocked by #n** chip for
  each open blocker (the card's chip, with the blocker's title on hover; one count chip under
  768 px, see **Narrow widths**), **Merged** on a ticket in
  **Done** that a merged pull request closed, a Linear issue with one attached, or a Jira issue whose key one names (the pull request **Merged** chip with a 12 px merge
  icon, its fill stepping up to `line-2` on hover, a link that opens the most recently merged one
  on GitHub, never the ticket under it), or the card's pull request stage chip on a ticket outside
  **Done** with an open pull request. When a session exists, the right side has the state chip,
  **Clear Needs you** on **Needs you** (not on **Done, session open**), **Raise cap** while it's
  stopped at its token cap, and the **Context** button whenever the
  [Gauges panel](#gauges-panel) isn't on screen: on **Details** and **Changes**, and on
  **Conversation** under 900 px wide, in the [shared header layout](#layout). Off
  **Conversation** it opens the newest session, whichever one **Conversation** shows, and a removed
  session's too, as **Conversation** still shows its panel; the session view, which shows no panel
  for a removed session, has no button for it either. The session's
  model, live tokens, latest step, branch, and **Sandboxed** are in the panel; the latest step
  also shows as the working line at the end of the conversation. The ticket's actions aren't in the header; they sit under the
  title at the top of **Details**, next to the text they act on.
- One line under the header shows errors and results: "Worktree removed", "Session ended and
  worktree removed", "Session ended. Kept the worktree: <reason>", or "Couldn't remove the
  worktree: <reason>". While the session is live, it also shows "Couldn't update <repo> from
  GitHub, so this branch starts from your local copy: <reason>" in `danger` on `danger-soft` when
  the fetch at **Start** failed, and, once finished, "Claude exited right after it started. Run
  claude in the session's folder to see why." when `claude` exited within 10 s of its launch. After a
  removal the session buttons go. **Start** runs the [Start check](#start-check-dialog) first,
  skips the Start dialog when the project has one repo and the ticket has a repo, and shows the
  [readiness check](#readiness-check) and the [overlap check](#overlap-check) under the header.
- When any of the project's instructions (see the **Instructions** row in
  [Add project](#add-project)) apply to the ticket, a strip under the overlap check, with a
  bottom border, 16 px side padding, and 6 px above and below, reads "Your instructions:" in 11 px
  `fg-2`, then each one that applies in `fg`: "Every ticket", then each matching label as the
  ticket has it, after its color dot. A 20 px ghost **Show** on the right lists each one's text,
  line breaks kept, beside its name in `fg-2` (truncated, in full on hover), and reads **Hide**
  while they show. It's a region named "Your instructions". With none that apply, there's no
  strip.
- A 36 px tab bar sits under the header: **Conversation** (speech-bubbles icon) once the ticket
  has a session, **Details** (document icon, followed by "N comments" in 11 px `fg-3` when there
  are any), then, once that session has a worktree, **Changes** (`FileDiff` icon, followed by the
  number of files in its list as a bare 11 px `fg-3` count when there are any, from any tab; the
  tab's accessible name and tooltip say it in words, as "Changes, 4 files changed"). A 2 px `fg`
  bar sits under the selected tab; tabs switch at once, with no slide. "⌘\ to switch" sits on the
  right in 11 px monospace `fg-3` while the panel is 768 px or wider, and ⌘\ moves to the next
  tab, wrapping from the last to the first.
- The view opens on **Conversation** when the session is live (running, needs you, or idle), and
  on **Details** otherwise. On reopening Sandtable, it opens on the tab you last had,
  **Conversation**, **Details**, or **Changes**, or on the default tab when that tab isn't there,
  as **Conversation** with no session or **Changes** with no worktree. **Start** and **Resume**
  switch to **Conversation**. Selecting **Conversation** focuses the composer, the terminal
  while the drawer is open, or the terminal in the **Terminal** view.
- Every tab stays mounted behind the others, so the session's terminal keeps its scrollback while
  another tab is showing. While another tab is selected and the session needs you, the
  **Conversation** tab shows the **Needs you** chip, or **Reviewing** while an automatic review
  round runs, but not on **Done, session open**; it goes
  when you select **Conversation**.
- **Details** scrolls on the left of the tab, and the chat panel fills the tab's height on its
  right. The details are a centered two-column grid, a main column up to 720 px and a 240 px aside, 48 px
  apart, with 24 px and 32 px padding. When the details area itself, not the window, is under
  832 px wide, which would leave the description column under 480 px, it becomes one column with
  the aside before the description, its sections side by side, 32 px apart.
- The main column opens with the title block, 32 px above the description, its parts 12 px apart:
  on a sub-issue, first an 11 px `fg-3` link, "Sub-issue of <#n or key> <title>": the parent's
  `#n` (`owner/name#n` in another repo) or Linear or Jira key in monospace, then its title cut off with an ellipsis, with the full title on hover, turning
  `fg-2` on hover; then the title as an 18 px weight 500 heading in `fg`, wrapping; a line of 11 px `fg-3` with the
  monospace `#number`, the repo, and "Created <date>" with the full date and time on hover; then
  the ticket's buttons, 28 px, 8 px apart: **Start**, the card's model chip, and an outline **Start with…** with a
  speech-bubble-plus icon and a 12 px chevron, whose menu opens the [note composer](#start-note-composer) across the row (**Start with note**) or runs the same checks as **Start** and starts Claude Code in plan mode (**Start with planning**)
  (no session, or the worktree removed), **Resume** and **Remove worktree** (finished session; **Remove
  worktree** first on a ticket in **Done**, the card's one action leading), or **End session and
  remove worktree** (**Done, session open**), then an outline **Open on GitHub** (**Open in
  Linear** or **Open in Jira** for a Linear or Jira issue) with an external-link icon. **Start** and **Resume** are primary;
  the others are outline. The ticket's buttons are disabled while one works and during the readiness and overlap
  checks. When another project has the card's [session elsewhere](#cards) row, it shows above the
  buttons under an 11 px `fg-3` "Session in another project" label, 6 px above it, without the
  card's 4 px reach; **Start**, **Resume**, and their companions go from the title block and from
  under the conversation. The aside starts level with the title; in one column the title block comes
  first, then the aside. The title block shows while the details load or fail, so the buttons are
  there before the text. While **Conversation** is selected, the title block leaves the ticket's
  buttons out, and a finished session's conversation shows them in place of the composer.
  - Main, on a parent: **Sub-issues** first, "N/M done" in 11 px `fg-3` beside a 4 px rounded
    `line-2` bar filled in `fg-2` by the done share, as on the card's progress, hidden from screen
    readers since the text says it. Then a list with a 1 px `line` border and `radius` corners, a
    36 px row per sub-issue, `line` rules between rows: the status icon, the monospace `#n`
    (`owner/name#n` in another repo, as **Blocked by** names it) or Linear or Jira key in `fg-2`,
    the title cut off with an ellipsis (the full title on hover), the state chip on
    `neutral-soft` in `fg-2` with the column's word (**To do**, **In progress**, **Done**, or
    **Closed** for one off the columns, such as a cancelled Linear issue or a GitHub issue closed
    as not planned, which has no icon), and the first assignee's 18 px avatar with no ring, naming
    them in a tooltip. A row turns `surface-3` on hover. When GitHub lists fewer sub-issues than
    the parent has (it lists 50), a last row, "N more on GitHub" in `fg-2` with a 12 px
    external-link icon, opens the parent on GitHub. Each row takes the on-board ticket's status
    and assignee when it's on the board. A row, or the title block's "Sub-issue of" link, opens
    the ticket view when its issue is on the board; one that isn't shows its issue state, opens
    on GitHub, Linear, or Jira, has a 12 px external-link icon in `fg-3` after its title, and its
    name tells screen readers it opens there. On a GitHub or Linear project, a ghost 24 px **Add sub-issue**
    with a plus icon follows the list, or stands alone above **Description** on a ticket with no
    sub-issues, with no heading, and not on a GitHub ticket whose repo isn't in the project. It
    turns into the [New ticket composer](#new-ticket-composer) in
    its place, and Escape or **Close** puts it back and focuses it. Jira shows sub-tasks without
    **Add sub-issue**.
  - Main: **Description**, the issue text as GitHub-flavored Markdown (20 px line height,
    `neutral-soft` inline code, `accent-bright` links, tables with `line` borders, read-only task
    checkboxes; images don't load; a link shows its target on hover), or "No description". Then **Comments** with the count,
    oldest first, each under a 1 px `line` rule: the author's avatar, as on cards, the author's
    name, and the time as "Oct 9, 17:46" (the full date and time on hover). Without comments:
    "No comments".
  - Aside: on a sub-issue, **Parent** first, one row like a sub-issue row. Then **Labels**, chips with a 1 px `line` border, an 8 px dot in the label's color,
    and the name in `fg-2`, a long one cut off with an ellipsis, or "No labels". **Linked pull
    requests**, rows with the state icon, the monospace number, the truncated title, and the
    state chip, each opening the pull request on GitHub, or "No linked pull requests". Last,
    **Usage**, which shows once the ticket's token use has loaded, and loads again with the details and whenever the project changes, as when a chat turn ends: the total in 18 px weight 500, "32M tokens", with the full
    count on hover; when Claude ran a turn in the ticket's sessions, "Claude worked 2h" in `fg-2`,
    the sum of its turns' run time, which leaves out time waiting on you and a turn stopped with
    Esc, read in words by screen readers ("2 hours"); a 6 px rounded bar of each token type's share on `surface-3`, hidden from
    screen readers; a row per type, **Input**, **Output**, **Cache write**, and **Cache read**,
    with an 8 px dot in its shade (`fg`, `fg-2`, `fg-3`, and `fg-4`; the word carries the
    meaning), its compact count with the full count on hover, and its percent in 11 px `fg-3` ("<1%" for a share that rounds to 0).
    Then an 11 px weight 500 `fg-3` **By model** heading and a row per model: its name, or its
    model ID in monospace when Sandtable doesn't know it, its compact tokens, and its price in
    `fg-2`, or "No price" in `fg-3`. Then a `surface-3` box with `radius` corners and 8 px
    padding: "API price estimate" and the summed price of the priced models, over "What this
    usage would cost on the API, not what you paid." in 11 px `fg-3`, followed by " Models
    without a price show tokens only." when any model has none. With no priced model, the box
    gives way to "No model here has a price, so this shows tokens only." in 11 px `fg-3`. With
    no usage, "No token use yet"; when reading it fails, "Couldn't read token use: <message>" in
    `danger`.
- Details load when the view opens: "Loading details" in 11 px `fg-3` over `surface-3` skeleton
  bars, then the content fades in over 180 ms (no fade with reduced motion). A failure shows
  "Couldn't load the ticket details: <message>" in `danger` on `danger-soft` with **Retry**. A
  sync that changes the ticket's labels or blockers loads them again, and the current details
  stay until the new ones arrive. If that load fails, the error and **Retry** replace the
  details; a later load that succeeds clears the error.
- **Conversation** is the live view of the ticket's latest session, or an earlier one you pick,
  with the [Gauges panel](#gauges-panel) on its right. It's there for a finished or cleaned-up
  session too. After a new **Start**, it shows the new session, not an earlier one. The session
  view uses the same conversation and panel. It loads when the view opens: "Loading conversation"
  over skeleton bars, as **Details**, or a centered "Couldn't load the conversation" /
  "<message>". It's a centered column up to 720 px with 24 px and 32 px padding.
  - On a live session, the list follows Claude Code's conversation file as Claude writes it, with
    no **Refresh**, and shows the last 500 entries. A finished session's conversation loads once.
  - While you're within 40 px of the end, the conversation glides to the end as it grows,
    including images, folds, and cards that add no entry, and it stays put once you scroll up.
    Sending a message goes to the end from anywhere. It jumps with no glide the first time the
    content overflows, when the end is more than one view away, and always under reduced motion.
    It doesn't follow while you type in a box inside it. Content that shrinks and grows again, such
    as the working line going away as the reply lands, doesn't stop it. The ticket chat panel and
    **Build with Claude** follow their end the same way, with their steps.
  - While you're scrolled away from the end, a 28 px round **Scroll to end** button (`ArrowDown`,
    with a Tip tooltip) sits centered 12 px above the bottom of the conversation, on `raised` with
    `shadow-md`, a 1 px `line-2` ring, and an `fg-2` icon that turns `fg` on hover while its fill
    stays. It fades in and
    rises 6 px over 200 ms with `ease-out-cubic`, with no rise under reduced motion. Clicking it
    goes to the end as sending does, follows again, and moves focus to the composer (or
    **Terminal** while the composer is off). The ticket chat panel and **Build with Claude** have
    it too. It floats over the bottom of the scroller, so it never covers the composer or the
    message tray, and it hides while the **Terminal** drawer is open over it.
  - In the ticket view, a toolbar line leads the column: "N messages" (your messages and
    Claude's) in 11 px `fg-3`, and, when the conversation has messages, a ghost icon button
    labeled **Summarize session** (`NotebookPen`) on the right. It drafts a summary of the shown
    session and switches to **Details** with the chat panel open, where the summary shows. When the
    ticket has more than one session, a small select named **Session** for screen readers leads
    the line: each option is the session's start time, as "Oct 24, 2026, 10:00", and its state
    chip, newest first. The toolbar stays above the loading, error, not-found, and empty states, so
    you can pick another session there.
  - Each message has an 11 px `fg-3` label, **You** or **Claude**, over its text as Markdown, as
    **Details** renders it (raw HTML isn't rendered). Your messages also sit in a `card` fill with
    `radius-card` corners and 8 px by 12 px padding, on the right, at most 80% of the column;
    Claude's are open text, so the label and the shape, not a color, tell them apart. Each code block
    and table in Claude's replies sits in a `neutral-soft` box with `radius` corners under a 28 px
    bar with a bottom `line` border: on the left, the code's language (or "Code") or "Table" in
    11 px `fg-3`; on the right, a ghost extra-small **Copy** button in `fg-3` with the copy icon,
    hidden until you hover the box or focus inside it. Its tooltip and accessible name are "Copy code" or "Copy
    table". It copies the code without its fence, or the table's Markdown rows as written, then
    reads **Copied** with a check, in its tooltip and name too, and announced as a status, for 1.5
    seconds after the latest copy. Your messages, the
    ticket chat panel, **Build with Claude**, and **Details** show no bar. Messages you
    type while Claude is working count as yours; auto-compaction summaries don't show. After
    `/clear`, the conversations before and after it show as one list, with a **You** message
    "/clear" between them. A compaction shows as one 11 px `fg-3` line, "Conversation compacted at
    14:05".
  - A slash command you ran shows as a card, the **Palette** direction picked from a prototype:
    `radius-card` corners and a 1 px `line` ring, with a header bar on `surface-2` over a 1 px
    `line` rule, 6 px by 12 px, holding the command and its arguments, such as `/rename menu`, in
    11 px monospace `fg-2` on the left and "Command output" in 11 px `fg-3` on the right. What the
    command printed follows in 11 px monospace that wraps, 8 px by 12 px, with links as in tool
    output; a command that printed nothing, or a skill, shows the header alone. `/clear` and
    `/compact` get no card, since the list already shows them.
  - Each automatic review round shows as a block in the same shape, the **Own color, one block**
    direction picked from a prototype, before the entry that came after Claude's turn ended, or
    after the last row when nothing has come since. Inside a run of tool calls, it goes before the
    next row. Its header bar holds "Automatic review · round 2 of 3" in 11 px `fg-2` on the left
    and the time the round started, such as "14:02", in 11 px `fg-3` on the right. Under it, 8 px
    by 12 px in 11 px `fg-2`: while the round runs, a spinner and "Reviewing 4 changed files…";
    once it ends, how it went: "Sent 1 proposal to Claude. 2 wait for you.", "Sent 2 proposals to
    Claude. None wait for you.", "Sent nothing to Claude. 1 waits for you.", "Found nothing new.
    2 wait for you." when the round found nothing and earlier proposals still wait, "Found nothing
    to fix.", or why it ended early, such as "The review failed: <reason>", one line of at most
    300 characters with anything that looks like a token replaced by "[redacted]", wrapping at any
    character. A hidden live region tells screen readers when the newest round starts and how it
    ends. In the ticket view, an **Open Changes** link in `accent-bright` sits at the
    right of that line and opens the **Changes** tab with keyboard focus on it. The block is Sandtable's note, not part of Claude's conversation: Claude
    never sees it, and a round that started before the loaded part of the conversation doesn't
    show.
  - Each run of tool calls between messages is one row: a chevron, "Ran N tools" in `fg-3`, then
    the last call's tool name and a short summary of what it acted on, in monospace `fg-2`,
    truncated, with no dot when there's no summary. The chevron points right, and down while the row is open. An open group lists its
    calls 22 px in, each a row of the same shape: the tool name in monospace, its summary in
    `fg-2`, truncated, and **Error** in `danger` when the call failed. An open call shows **Input**
    and **Output**, each an 11 px `fg-3` label over monospace text on `surface-3` that wraps, or
    "No output" when the call returned no text. A URL in a call's input or output is an
    `accent-bright` underlined link, with the URL on hover, that opens in the browser.
  - A pill at the top right of the conversation area, 8 px from the top and 16 px from the right,
    floats over the list: `panel` with a 1 px `line` ring, holding two 24 px ghost icon buttons
    in `fg-3`, **Find in conversation** (`Search`, tooltip "Find in conversation (⌘F)") and
    **Your messages** (`List`), which doesn't show while you've sent no messages. The pill shows
    once the conversation has entries. While the conversation area is under 800 px wide, the
    ticket view's toolbar line keeps 80 px clear on its right so the pill doesn't cover
    **Summarize session**.
  - **Your messages** opens a 340 px popover under the pill, aligned to its end, on `raised` with
    a 1 px `line-2` ring and at most 60% of the window tall: a "Filter your messages" field over a
    list of your messages, each its first line, truncated, or "2 images" for a message of only
    images; "You stopped Claude." markers aren't listed. Up and Down move the selection, a
    `surface-3` fill, and Enter or a click scrolls that message to the top of the conversation and
    closes the popover. The message you're scrolled to when it opens is the one first selected,
    and it keeps a `neutral-soft` fill when the selection moves off it. "No message matches." in
    `fg-3`, announced politely, when the filter leaves none.
  - ⌘F, while **Conversation** shows and no dialog is open, or **Find in conversation** replaces
    the pill with a 36 px find bar in the same spot, on `raised` with `radius-card` corners, a
    1 px `line-2` ring, and a shadow, scaling in from its top-right corner over 150 ms (no motion
    with reduced motion), floating over the ticket view's toolbar line, so it covers **Summarize
    session** while it's open: a 200 px field, "Find in conversation", a count in 11 px tabular
    `fg-3`, "3 of 12", "3 of 1000+" past 1,000 matches, or "No matches" in `danger`, announced
    politely when the query or the current match changes, not when new entries change the
    total, then ghost icon buttons
    **Previous match** (`ChevronUp`, tooltip "Previous match (⇧↩)"), **Next match**
    (`ChevronDown`, "Next match (↩)"), both disabled with no matches, and **Close** (`X`, "Close
    (Esc)"). Matches are case-insensitive, in messages and tool rows, including the input and
    output of folded tool calls. Find skips Sandtable's own labels: **You** and **Claude**, "Ran N
    tools", **Input**, **Output**, "No output", "Command output", "You stopped Claude.",
    "Conversation compacted at …", "Deleted", an automatic review round's block, and a code block's
    or table's bar. Each match is highlighted in `selection` and the current one in
    `find-current`, without changing the text. The first current match is the first at or below
    the top of the view. Enter and Shift+Enter step to the next and previous match, wrapping,
    open any folded group and call around it, and scroll it to the middle. Esc or **Close** clears
    the highlights and returns the focus to the composer, or to **Find in conversation** when
    there's no composer to type in.
  - While the session is **Running** and Claude isn't asking you something, the list ends with
    the working line (see Motion), reading "Claude is working…" before Claude's first step and announced as a status, then the time
    since your prompt, as the activity strip shows it, and a ghost xs **Stop**. **Stop** sends Esc
    to the session, which interrupts Claude's turn; it's disabled after a click until the session
    leaves **Running**, or for 3 s. It's refused while Claude asks you something and while the
    session starts, as every send is, and while a message is being typed into the session. Once
    Esc reaches the session, it shows **Needs you**, since Claude Code fires no hook at an
    interrupt. Claude Code's "[Request interrupted by user]" marker shows as "You stopped Claude."
    in 11 px `fg-3` on a line of its own, not as your message.
  - Without a file for the session, a centered message says "Conversation not found" / "Claude
    Code hasn't written this session's conversation, or its history was cleared."; with an empty
    file, "No messages yet" / "The conversation is empty."
  - On a live session, the composer sits under the list, 8 px above and 16 px from the bottom, as
    wide as the column: the chat panel's field, with "Message Claude" as its placeholder, the
    ghost xs **Terminal** toggle, and **Send**. Enter sends and Shift+Enter adds a line. Sending
    pastes the text into the session and presses Enter, the same path as **Send to session**: it
    works while Claude is working, which queues the message, and it's refused while the session
    starts. A refused **Stop** or image shows in `danger` on `danger-soft` above the field, until
    the next paste, drop, or send. While
    Claude asks you something, the box is disabled and its placeholder reads
    "Answer Claude's question to send a message" while the question card shows, or "Answer Claude
    in the terminal first" without it.
  - While the field's text is `/` and any characters but a space, and you haven't pressed Esc
    since it last changed, the command palette, the **Palette** direction picked from a prototype,
    floats 6 px above the field, as wide as it and 250 px tall, on `raised` with `radius-card`
    corners, a 1 px `line-2` ring, and a shadow. It fades in and rises 6 px over 150 ms
    (`ease-out-cubic`) when it opens, with no motion under reduced motion. Its left 42%, past a
    1 px `line` rule, is a listbox named "Commands": each option is the command, such as
    `/compact`, in 11 px monospace `fg`, truncated, and its argument hint in `fg-4`, truncated
    at 128 px, 5 px by 8 px with `radius` corners, `surface-3` while active. Screen readers hear an option's
    name, its whole hint, and its description. The right
    pane, 14 px by 16 px, shows the active command with its whole hint in `fg-4`, its description,
    its other names in 11 px `fg-3`, such as "Also /cost, /stats", when it has any, its source
    in 11 px `fg-3` ("Built into Claude Code", "Your command or skill", "This repo's command or
    skill", "Synced from claude.ai", or "From <plugin>"), and at the bottom, in 11 px `fg-4` with keys in
    18 px monospace boxes with a 1 px `line-2` ring, "↑ ↓ to move · Tab or Enter to fill in · Esc
    to close". The list holds the session's commands whose name or other name is the text after
    `/`, then those where one starts with it, then those where one contains it; "No command matches /xyz" in `fg-3` when none do, "Loading
    commands…" while Sandtable asks Claude Code for them, the first time you type `/` in that
    session, and the error in `danger` if that fails, until you type `/` again, which asks again;
    screen readers hear each of these as a status. Claude Code's own list leaves out
    terminal-only commands such as `/resume`, and Sandtable leaves out those that open a panel
    with no arguments, such as `/model`, `/usage`, `/config`, `/mcp`, and `/goal`, by name or
    other name, and `/send-to-project`. The field is a combobox for
    screen readers, named "Message", expanded while the palette lists options, whose active
    descendant is then the active option. Up and Down move, wrapping; Enter or Tab fills in `/<name>`, with a space after it when
    the command takes an argument, and closes the palette; Shift+Tab moves the focus as usual; Esc
    closes it and does nothing else. With no option listed, Enter sends the text as usual and Tab
    moves the focus.
    The pointer highlights the option under it, and pressing one fills it in, keeping the focus in
    the field.
  - While the session is live and isn't **Running**, Claude isn't asking, and the field is empty,
    Sandtable reads Claude Code's suggested next message from the terminal every 3 s while the
    conversation shows. The suggestion is the field's placeholder, a "Suggested · Tab" pill, 18 px
    on `neutral-soft` in 11 px `fg-3`, hidden from screen readers, follows **Terminal**, and screen
    readers hear "Suggestion: <text>. Press Tab to use it." as the field's description and, when it
    arrives, as a polite announcement. Tab or
    Right fills the field with it, with the caret at the end, and Shift+Tab moves the focus; Sandtable never types it into the
    session. It goes as soon as Claude works or asks or you send, isn't read while a message you sent is
    still being typed, and comes back when you empty
    the field while Claude Code still suggests it.
  - **Send** empties the field and puts the message in a tray over it at once, the **Tray**
    direction picked from a prototype: a list named "Messages waiting for Claude", 6 px above the
    field, of rows 4 px apart. Each row is at least 32 px tall, on `surface-2` with `radius` corners
    and a 1 px `line` inset ring: a 56 px state word in 11 px `fg-3`, **Queued** while the session
    is **Running** and **Sending** otherwise, then the message's first line in `fg-2`, truncated,
    or "2 images" for a message of only images. A polite screen-reader status reads "2 messages
    waiting for Claude" as the count changes. Sandtable types the messages into the session one at
    a time, in the order you sent them. A row leaves the tray when the conversation shows the
    message: the first message of yours with the text Sandtable typed, after the entries the
    conversation had when you sent it and after the one the message before it landed on, counted
    from the conversation's start, so a reload that leaves out older entries doesn't strand it. A
    row whose message lands after a later one leaves with it, and a command starting with `/` or
    `!` leaves once it's typed, since Claude Code doesn't write it as a message. A failed send
    reads **Not sent**, its ring turns `danger`, and it ends with a ghost xs **Remove** and an
    outline xs **Send again**, disabled while Claude asks you something, with the error under it
    in 11 px `danger`, announced. **Send again** sends it at the end of the line, the same path as
    the composer, and both buttons return the focus to the field. The tray empties when the
    session stops being live.
  - Pasting or dropping a PNG, JPEG, GIF, or WebP image up to 10 MB attaches it. A paste that also
    carries text, such as cells copied from a spreadsheet, pastes the text instead. While a file is
    dragged over the field, the field takes the `ring` color and reads "Drop to attach" in `fg-2`
    over `card` at 90%. Each attached image is a 24 px `neutral-soft` pill with a 1 px `line` ring,
    in the row before **Terminal**: a 20 px round preview, the file's name in 11 px `fg-2`,
    truncated, "· 1.3 MB" in `fg-3`, and a 20 px ghost icon button named **Remove image 1**, with a
    tooltip; the pills wrap. **Send** works with images and no text, and waits while an image is
    still being read. Another file, or a bigger image, isn't attached, and the refusal line names
    it, such as `"trace.pdf" wasn't attached. Sandtable sends PNG, JPEG, GIF, and WebP images.`
    The line clears at the next paste, drop, or send.
  - Your message shows a 44 px thumbnail of each image you sent after its text, `radius-sm` with a
    1 px `line` ring, each a button named **Show image 1 larger**, with a tooltip. Clicking one
    shows the image at the bubble's width under the row and marks its thumbnail with a 2 px `fg-3`
    ring, and clicking it again hides it. When the session's worktree was removed, which deletes
    the images, each thumbnail is a box that reads "Deleted" in 11 px `fg-3`.
  - While Claude asks you something the card can show, the list ends with the question card, the
    **Inline** direction picked from a prototype: a `radius-card` box on `card` with a 1 px `line`
    inset ring, 12 px padding and 10 px gaps, a region named for what Claude waits on: "Claude is
    asking you something", "Claude needs your permission", or "Claude is waiting for you to
    approve a plan". Its header row is the **Needs you** chip, that name in weight 500, and a
    ghost sm **Open in terminal**, which opens the drawer. Each choice is a full-width `radius-sm`
    row button with its number in `fg-3`, hidden from screen readers, its label as its name, and
    its description in 11 px `fg-3` under it as its description, with `surface-3` on hover.
    - Questions: with more than one, a row of sm buttons names each question's header and
      **Submit**, a group named "Questions", the current one outline with `aria-current="step"`,
      **Submit** disabled until every question has an answer; screen readers hear "Answered:"
      before an answered question's header. Answering a question moves to the next one without an
      answer, or to the review. A single-select question is the question in weight 500 over
      its choices; clicking one answers it and moves to the next unanswered question, or sends a
      lone question. With previews, the choices sit beside the focused option's preview, a
      monospace `neutral-soft` region named "Preview of Blue" that follows hover and focus, with
      the focused choice on `surface-3`, over a
      ghost sm **Add a note on Blue** that opens a field and a **Pick Blue** button. Without
      previews, an **Other** row opens a field with **Next**, or **Send** for a lone question. A
      multi-select question is a fieldset of checkbox rows, "Choose any." in `fg-3` after the
      question, an **Other** checkbox that shows a field, and **Next**, or **Send** for a lone
      question. Both **Other** fields read "Your answer". **Submit** shows "Review
      your answers" as a two-column list of headers in `fg-3` and answers, and **Submit
      answers**. A ghost sm **Chat about this** sits in the footer.
    - A permission is the tool's name in mono 11 px `fg-3`, followed by " · from the
      general-purpose agent" when a subagent asks, its full input in a `neutral-soft` mono box up
      to 240 px tall, "Do you want to proceed?" in `fg-2`, and the terminal's choices. **No** on
      the main session's permission stops Claude, as **Stop** does, and the composer then takes
      what to do instead; on a subagent's, it declines only that subagent's tool call.
    - A plan is its Markdown in a focusable region up to 384 px tall, named "Claude's plan", "Would
      you like to proceed?" in `fg-2`, and the terminal's choices; **Tell Claude what to change**
      opens a three-line field and **Send changes**.
    - After you answer, everything under the header turns inert, and a status line at the foot
      reads "Sending…" after a spinner, then "Sent" until asking ends and the card goes; **Open in
      terminal** stays usable. A refusal, such as "The terminal has moved on from this question.
      Answer it there.", shows in `danger` on `danger-soft` at its foot. Sandtable refuses when
      Claude now asks something other than what the card shows, or the terminal has a choice
      picked, the cursor moved, or another question showing.
    - When the card appears while the focus is nowhere or in the disabled composer, the card takes
      it as a whole, not a choice, so a key already on its way can't answer. Moving to another
      question or the review puts the focus on it, and when the card goes with the focus lost, the
      focus returns to the message box. The card reloads when a tool call gets its answer, so a
      second parallel permission replaces the first, and after you answer a subagent, so its next
      request, or another subagent's, replaces the one you answered.
  - The terminal drawer holds the session's live terminal. It's a region named **Terminal**, 280 px
    tall, 16 px in from the sides of the whole conversation area, not the 720 px column, on
    `surface` with `radius-card` top corners, a `shadow-card`, and a 1 px `line-2` ring, sliding
    over the bottom of the conversation, which gains 280 px of bottom padding so its end stays in
    view. A 32 px header with a `line` rule
    under it reads "Terminal" in 11 px `fg-3`, or "Claude is asking you something" in `amber`
    while Claude asks, with a ghost xs **Hide** on the right. The drawer opens and takes the focus
    when Claude starts asking something the question card can't show, and closes when asking ends
    unless you opened it yourself. If the
    message box had the focus when asking started, **Hide** takes it instead of the terminal, so a
    key already on its way can't answer Claude's prompt. Asking
    ends on the session's next hook event, so after you approve a command the drawer stays open
    until the command finishes, and you watch its output there. **Terminal** on the composer opens
    it, and screen readers hear it as pressed while the drawer is open. The drawer covers the
    composer, so with a pointer **Hide** closes it, at any time; closing it while Claude asks
    doesn't enable the composer. When the drawer closes with the focus in it, the focus goes to the
    message box, or to **Terminal** while the box is disabled. Sandtable's status line shows inside
    the terminal, under Claude Code's prompt (see
    [Terminal](#terminal)).
  - On a finished session, there's no composer or drawer. Under the latest session, the ticket's
    buttons, or the [note composer](#start-note-composer) while it's open, sit centered where the
    composer was, under the [session elsewhere](#cards) row when another project has one; an earlier
    session you picked shows no buttons. A session whose worktree was removed shows "The branch
    stays on GitHub. Start makes a new worktree." in `fg-2` above them.
  - In the **Terminal** view, picked in the [Gauges panel](#gauges-panel), the live terminal fills
    the area of the conversation and the composer, on `panel` with 8 px padding, and takes the
    focus when the tab or the view opens. The terminal keeps Tab, Shift+Tab, and Esc for Claude
    Code, so F6 moves the focus to the next control after it, and Shift+F6 to the one before, also
    in the drawer. The ticket view's toolbar line, with the **Session**
    picker and **Summarize session**, stays above it, with 12 px above, 8 px below, and 16 px at the sides. There's no drawer,
    question card, working line, message tray, find pill, or find bar. On a session that isn't
    live, a centered "The session ended." with "Its terminal closed with it." in `fg-2` replaces
    the terminal, with the buttons the **Conversation** view shows where the composer was under it.
- **Changes** shows the diff of the ticket's latest session's worktrees against each one's merge base
  with `origin/HEAD`, with commits, uncommitted edits, and untracked files. It reads the diff when
  the ticket view opens, so the tab's count is right from any tab: "Loading changes" over skeleton
  bars, as **Details**, or "Couldn't read the changes: <message>" with **Retry**. It reads again on
  **Refresh**, when the project's board changes, and when the
  session goes from **Running** to **Needs you**, **Reviewing**, or **Idle**, keeping what's shown until the new
  diff arrives. With changes to show, the tab has three columns: the file list, the diff, and the
  Findings rail. It never stages, commits, merges, or discards anything.
  - A file list on `window` with a 1 px `line` border on its right fills the tab's height on the
    left. It's 300 px wide and shrinks to 192 px in a narrow window, with the rail, so the diff
    keeps at least 240 px and **Send to session** stays in view. Its 40 px top bar has "N files changed" in 11 px `fg-3`, the summed counts, and a
    ghost icon button labeled **Refresh** (`RefreshCw`) on the right. Each file is a row with
    `radius` corners: the file name in medium weight and its counts on the first line, its folder
    in 11 px monospace `fg-3` and its change word in a `neutral-soft` chip with 11 px `fg-2` text,
    **Added**, **Modified**, **Deleted**, or **Renamed**, on the second; a renamed file's old path shows on
    hover. The selected row is `card` with a 1 px `line-2` inset ring; others step to `surface-3` on
    hover. A file with findings on it shows "N findings" in a `neutral-soft` chip before its change
    word. With a row focused, Up and Down move the selection and the focus at once. When the session has more than one worktree,
    each repo's files sit under an 11 px weight 500 `fg-3` heading with the repo's name, with "No
    changes in this repo" under one without changes. A repo Sandtable couldn't read shows
    "Couldn't read the changes: <message>" in 11 px `danger` instead of its files; when no repo
    could be read, the tab shows that line with **Retry** in place of the list and the diff.
  - Counts are 11 px monospace, `+N` in `added` and `−N` in `removed`; a binary file says "Binary"
    in `fg-3` instead.
  - The selected file fills the rest: a 40 px bar with its path in monospace (`old → new` for a
    rename), its change chip, its counts, and "↑ ↓ in the list to move between files" in 11 px `fg-3` on the
    right, over its diff, which scrolls both ways. Each hunk starts with its `@@` line on
    `window` in `fg-3`, then one row per line in 11 px monospace with 18 px line height: the old
    and new line numbers in `fg-4`, the `+` or `−` sign in `added` or `removed`, and the text in `fg`,
    on `added-soft` or `removed-soft` for added and removed lines. Screen readers hear "Added:" or
    "Removed:" before the text. A binary file says "Binary file, not shown." A file with more than
    1,000 diff lines, and every file after the first 300, says "This file changed N lines; the diff
    is too large to show them here." A line over 2,000 characters is cut off with "…". Characters that reverse the text direction show as `<U+202E>`
    and the like, in file names and lines, so text can't read differently from what it is.
  - A gutter column after the line numbers holds a 16 px round **+** in `fg-4` on each line with a
    new-side number, added or unchanged; a removed line has none, as it's no longer in the file.
    It shows when you hover the row or focus it with the keyboard, takes an `fg` fill with
    `surface` text on hover, and is labeled "Comment on line N", with "Shift-click or Shift+Enter
    to select a range" on hover. The **+** buttons are one tab stop: the selection's first line,
    or the file's first line, takes the focus, and Up and Down move it to the previous or next
    **+**. Clicking a **+** selects that line; Shift-clicking another line in the same file
    selects the range between them, keeping the first line as its pivot. Selected rows are on
    `selection` in place of their tint, with their **+** filled and pressed. When the diff reads
    again, the selection follows its first line's text, and it's dropped, keeping what you typed,
    when that text is gone. A line under a finding that isn't **Outdated** has a 2 px `fg-3` bar
    at its left edge, and screen readers hear "Has a finding".
  - The composer opens in a row under the selection's last line, on `panel` and indented 96 px:
    a box up to 640 px wide on `card` with `radius` corners and a 1 px `line-2` inset ring. It has
    "Comment on <file>, line N" (or "lines N–M") in 11 px `fg-3`, a text area that takes the focus
    with "What should change here?" as its placeholder, and a ghost xs **Cancel** and a primary
    xs **Add comment** on the right, disabled while the text is empty or saving. Command-Enter
    adds and Escape cancels. A failed add shows "Couldn't add the comment: <message>" in 11 px
    `danger` above the buttons, which screen readers hear at once, and keeps the text. After the
    add, **Cancel**, or Escape, the focus returns to the range's first **+**; an add that finishes
    after you selected other lines leaves that selection open.
  - The Findings rail sits on the right of the diff, on `window`, with a 1 px `line` border on its
    left. It's 340 px wide and shrinks to 256 px in a narrow window. It also shows beside "No
    changes" and beside "Couldn't read the changes" with **Retry**, so saved findings and the pull
    request's checks stay in reach; it doesn't show while the diff loads or after **Remove
    worktree**.
    - Its 40 px header, with a 1 px `line` rule under it, has a segmented switch named "Findings
      to show" with **To send N** and **Sent N**, starting on **To send**.
    - A status block in 11 px `fg-3` follows the header, 8 px by 12 px padding over a 1 px `line`
      rule, with an outline xs **Claude review** on its right, whose tooltip says "Claude reads
      the branch's diff and proposes findings. Sent findings stay as they are." While a review
      runs, here or from an earlier visit, the button is disabled and reads **Reviewing** after a
      spinner. The block's first line says "Claude review reads the branch's diff and proposes
      findings." before any review, "Claude is reviewing the diff." while one runs, and "Last
      Claude review: review N, <date and time>." after one. While automatic review is on for the
      session, or
      turned off for it, a second line says "Automatic review:
      waiting for Claude to end its turn with an open pull request.", "Automatic review: round
      <n> of 3." while the automatic review's own review runs, "Automatic review: <n> of 3 rounds done.", "Automatic review
      stopped: the last review had no High proposals.", "Automatic review stopped after 3
      rounds.", or "Automatic review is off for this session."
    - The body scrolls, with sections under 11 px weight 500 `fg-2` headings. **Pull request**
      comes first: "Loading the pull request" in 11 px `fg-3`, "No open pull request for
      <branch>.", or "Couldn't read the pull request: <message>" in 11 px `danger`. Each open pull
      request from the session's branch, in each of its GitHub repos, has its "#<n> <title>" as an
      `accent-bright` link, then a 28 px row per check: an 8 px dot (`added` passing, `danger`
      failing, `yellow` pending), the name, and **Passing**, **Failing**, or **Pending** in 11 px
      `fg-3`. A row "Review" carries the decision, **Approved**, **Changes requested**, or
      **Review required**. Each unresolved thread is a row with its author and `path:line` in
      11 px `fg-3` over its first line. A title or thread line cut short shows in full on hover.
      Only a failing GitHub Actions check and each thread end in an outline xs **Add**, which reads **Added**, disabled, once its finding exists; a check added
      without its log keeps **Add**, and adding it again replaces it. Its accessible name names
      the check or thread. The section reads again on **Refresh** and when the session goes from
      **Running** to **Needs you**, **Reviewing**, or **Idle**.
    - A failed review shows "Couldn't review the changes: <message>" in `danger` on `danger-soft`
      under the pull request, until the next review starts. A review that stored no proposals
      says "The review found nothing to change." in `fg-3` there, until the next review starts.
    - **To send** shows the pull request, the proposals, and the unsent findings; **Sent** shows
      only the sent ones.
    - **Review proposals**, with its count in `fg-3` and a ghost xs **Keep all** on the right of
      its heading, shows only while there are proposals: each is a `card` box with `radius` corners and a 1 px
      `line-2` inset ring, holding the finding and an outline xs **Keep** and a ghost xs
      **Discard**.
    - **To send** and its count in `fg-3`, with a **Select all** checkbox in 11 px `fg-3` on the
      right of its heading, outside the heading, list the kept findings not yet sent, each a row with `radius`
      corners that steps to `surface-3` on hover: a checkbox labeled "Send <path>:<lines>",
      checked when it's added, then the finding and a ghost xs **Delete**. **Select all** shows a
      minus while only some are checked, and clears them all when all are. The list shows nothing
      until the findings load. With none, "No findings yet. Comment on a line, or run Claude
      review." in `fg-3`, or "Nothing left to send." when all are sent; when they can't be read, "Couldn't read the findings: <message>" in
      11 px `danger`. After **Delete**, the focus moves to the next row's checkbox; after **Keep**
      or **Discard**, to the next proposal's **Keep**; and to the **To send** heading when its
      list is empty or after **Keep all**.
    - **Sent** opens with "These went to the session. They stay here and aren't sent again." in
      11 px `fg-3` over its list, or says "Nothing sent yet." with none; it shows nothing until
      the findings load, and the same error as **To send** when they can't be read. After
      **Delete**, the focus moves to the next sent row, or to **Sent** in the switch when none is
      left. Each sent finding is a 28 px row in 11 px `fg-3` with
      `radius` corners that steps to `surface-3` on hover: a chevron, its source, its place in
      monospace, its severity, and a **Sent** chip on the right. Its accessible name reads
      "<source> <path>:<lines>, <severity>, Sent". Clicking it turns the chevron 90° and shows the
      finding's text, a check's log, and a ghost xs **Delete** under it, indented to the source.
    - A finding's first line, in 11 px `fg-3`, says where it came from (**You**, **Claude
      review**, **PR check**, or **PR comment**, with " · <author>" for a thread), then its place in monospace
      `fg-2`: "<file>:N–M" for a line finding, which jumps to the line in the diff when the file
      is in it (underlined on hover, with the full path on hover), or the check's or thread's
      title otherwise. The jump scrolls the line and the file's row into view and moves the focus
      to the line's **+**. Then a review's severity, **High** in `danger`, **Medium** in `amber`,
      or **Low** in `fg-3`, and the `neutral-soft` chips **Outdated**, when its first line's text
      is no longer in the diff, and **New** when the latest of two or more reviews proposed it. Under it, the text, which wraps, in `fg-3` once
      sent, and a check's log in 11 px monospace `fg-3` on `surface-3` with `radius` corners, cut
      at 64 px. Each button and checkbox names
      the finding by its full path, such as "Go to src/a/index.ts:12" and "Delete
      src/a/index.ts:12".
    - The footer, with a 1 px `line` rule above it, has an 11 px `fg-3` reason, which screen
      readers hear as it changes, over an outline **Send all N** and a primary **Send to
      session**, right-aligned. The reason says "The session isn't running. Resume it to send."
      once it's **Finished**, "Claude is asking you something. Answer it in the terminal first."
      while Claude waits on a permission or a question, "No findings to send." with none,
      "Nothing left to send." with every finding sent, "Check the findings to send, or use Send all." with nothing checked, and
      "Pastes N findings into the terminal as one message, after anything typed there. Sent
      findings aren't sent again." otherwise. After a send, it says "Sent N findings to the
      session." until you check another. **Send to session** sends the checked findings and is
      disabled in all but the last case; **Send all**, whose tooltip says "Sends every finding
      in To send, checked or not.", is enabled while any is unsent and the session can take it.
      Both are disabled while sending. A failed action shows "Couldn't
      <action>: <message>" in `danger` on `danger-soft` above the footer, such as "Couldn't send:
      …".
    - Send pastes "Review findings to address:" and one numbered item per finding: its place
      first, `path:N-M` (under its repo folder when the session has more than one worktree) or
      the check's title, then where it came from, `(review, high)`, `(PR thread by @<author>)`,
      or `(check)`, then the text indented three spaces, with a thread's text and a check's log
      in fenced blocks. Each line finding names its lines as they are in the worktree's file at
      that moment. The message loses control characters, so nothing in it can end the paste.
  - With no changes in any repo, a centered message says "No changes" / "Nothing changed since the
    branch left origin/main." with an outline xs **Refresh** under it. When some repo couldn't be
    read and the others have no changes, the diff side says "No changes" / "The repos Sandtable could
    read have no changes." After **Remove worktree**, it says
    "Worktree removed" / "The branch stays on GitHub. Its changes show on the pull request."
- The chat panel is a conversation with Claude about the ticket; Claude can only read the code.
  It sits on the right of **Details**, with or without a session, and needs no worktree or tmux.
  It's 380 px wide, and at most half the tab's width, on `window` with a 1 px `line` border on its left;
  **Details** takes what's left, and its grid follows the width of that area as above. It's open
  when the view opens, unless the window is under 900 px wide. The header, messages, draft, and
  composer share the panel's `window` fill with no rules between them, so the panel reads as one
  surface. A 40 px header has "Chat" in medium weight, then on the right a ghost xs **Start over** button
  once a chat exists and a ghost icon button labeled **Hide chat** (a panel-closing icon). **Hide
  chat** folds the panel to a 40 px `window` rail with a `line` border on its left and a ghost
  icon button labeled **Show chat** (speech bubble with a question mark) at its top; **Show chat**
  opens it again with what you typed still there. Each of the two moves the focus to the other
  button, so the keyboard doesn't lose its place; opening the view doesn't move the focus.
  Whether it's open lasts while the view is open and isn't saved. **Start over** opens a dialog, "Start over?" / "This deletes the chat with
  Claude about this ticket. Comments you posted stay on GitHub." (Linear or Jira in a Linear or Jira project), with **Cancel** and a destructive **Start
  over**.
  - It loads the saved chat the first time it shows on **Details**: "Loading chat" over skeleton
    bars, or "Couldn't load the chat: <message>" with **Retry**, both 16 px in from the panel's
    edges. It loads again whenever the
    project changes, which includes each time a chat turn ends, so a turn that was still running
    when you left the view shows its answer when it lands.
  - Under the header, a scrolling area with 16 px padding and 16 px gaps holds the messages
    and the status line. Each message has an 11 px `fg-3` **You** or **Claude** label over
    the text as Markdown, as on the **Conversation** tab. Your messages also sit in a `card` fill
    with `radius-card` corners and 8 px by 12 px padding; Claude's are open text on the panel, so
    the label and the shape, not a color, tell them apart. While the chat has no messages, a centered message says
    "Ask Claude about this ticket" / "Claude reads the ticket and the repo's code, and can't change
    anything.", over three outline xs buttons in a centered row that wraps, 6 px apart and 12 px under the
    text: "Which files would this touch?",
    "What's unclear in this ticket?", and "How would you split this into tasks?". Each sends its
    text as your message.
  - The composer is pinned to the bottom of the panel, 16 px in from its sides and bottom, in
    line with the messages: one rounded field, the same as **New ticket**'s, with a `card` fill,
    `radius-card` corners, a 1 px `line-2` inset ring that turns `focus` while the field holds the
    focus, fading in as the focus ring does, and 12 px padding (8 px at the bottom). In it, a borderless three-row text box named **Message**, which grows with its
    text up to 240 px, with "Ask about this ticket" in `fg-4` as its placeholder. Enter sends and
    Shift+Enter adds a line; Enter while an input method is composing doesn't send. Under the text,
    inside the field, **Send** (primary, small, disabled while the box is empty) on the right.
    Above the field, a segmented control named "Write to", the **Appearance** toggle's shape at
    the width of its names, switches the field between **Ask Claude** and **Comment**, so the panel
    holds one text box at a time. While you're on **Ask Claude** with a draft that has text,
    **Comment** reads "Comment •", and screen readers hear "Comment, has a draft". The result
    line, in 11 px `fg-2` and announced as a status, and errors, the `danger` on `danger-soft`
    alert line, sit above the control.
  - While Claude answers, the working line (see Motion), reading "Claude is answering" before
    Claude's first step, sits under the messages, announced as a status, and the text boxes and every button but **Hide chat** and **Stop** are disabled; the **Ask
    Claude** and **Comment** switch stays enabled. **Draft with Claude** says "Claude is drafting a comment", **Rewrite with Claude** "Claude is rewriting the comment", **Post comment** "Posting comment", and **Start over**
    "Starting over"; each names what the line reads before the first step. The line shows the latest
    step Claude takes in an answer, draft, or rewrite. While Claude answers, drafts, or rewrites, **Stop** (primary, small) takes
    **Send**'s or **Post comment**'s place and stays enabled; it ends the run, the working line goes away, no error shows, your
    text stays in the box, and the box takes the focus, or the draft does when you stopped from **Comment**. Claude Code keeps a stopped follow-up message in the chat's
    conversation, so the next answer can still see it. A session summary has no **Stop**. Your
    text stays in the box until the answer arrives; then the box clears,
    both messages show, the panel follows its end as the session conversation does, and the box
    takes the focus again. When the message fails, the text stays and the error shows.
    Reopening the view while a turn runs shows "Claude is answering" with everything but **Hide
    chat** and **Stop** disabled until it ends, and the line picks up at Claude's next step. While a session summary runs, the line says "Claude is
    summarizing the session" instead, with the same disabled controls, and a failed summary
    shows "Couldn't draft the session summary: <message>" as an alert line above the field, until
    the next summary or **Start over**; it isn't saved.
  - **Comment** puts the comment field in the message field's place, with the same shape: "Reply
    on GitHub as you" ("Reply on Linear as you" or "Reply on Jira as you" in a Linear or Jira
    project) in 11 px `fg-3`, the label of a borderless six-row text box with "Write a comment" as
    its placeholder, which grows up to 240 px. Enter adds a line. Under it, **Draft with Claude**
    (outline, xs) on the left, which reads **Rewrite with Claude** once the draft has text, then
    **Discard** (ghost, xs) and **Post comment** (primary, small, disabled while the draft is
    empty) on the right; **Stop** takes **Post comment**'s place while Claude drafts or rewrites.
    On an empty draft, **Draft with Claude** asks Claude to sum up the chat, and is disabled until
    the chat has a message; on a draft with text, **Rewrite with Claude** asks Claude to rewrite it
    using the ticket and the chat. Either one replaces the text and posts nothing. Switching to
    **Comment**, and Claude finishing a draft or a rewrite, puts the focus in the draft's text box;
    switching to **Ask Claude**, posting, and **Discard** put it in the message box. The draft,
    Claude's or yours, is saved when its text box loses the focus, when you switch to **Ask
    Claude**, and when you leave the view, so it stays across leaving the view and restarts; an
    empty draft that was never saved isn't, and clearing a saved draft deletes it. A saved draft with text opens the panel on **Comment**. After a run ends, the focus goes to the
    box of whichever side is showing.
    When a save fails, "Couldn't save the draft: <message>" shows as an alert line above the
    control, until a save works. **Post comment** adds the text to the issue, clears the draft,
    switches to **Ask Claude**, says "Comment posted" in the result line, and loads **Details**
    again, so the comment shows under **Comments** on the left. **Discard** deletes the draft and
    switches to **Ask Claude**.
  - A session summary lands in the same draft and switches the panel to **Comment**,
    unless the message box holds the focus, where **Comment** gets its marker instead, with a
    **Session summary** property chip before the label, so the text box's name starts with those
    words. Posting or discarding a summary on a chat with no messages deletes that chat, so
    **Start over** goes away with it.

### Gauges panel

- The Gauges panel is a 256 px column, named **Session**, on the right of a session's
  conversation, in the ticket view's **Conversation** tab and in the session view, with a 1 px
  `line` border on its left and 16 px padding. It scrolls on its own, and its text is 11 px.
- It opens with a block that ends 16 px above a 1 px `line` rule: "View" in `fg-3`, then a
  segmented control named **View**, **Conversation** with a chat icon and **Terminal** with a
  terminal icon, a radio group for screen readers. The choice is one for every session, saved in
  the renderer, and starts as **Conversation**. Under it, while the session isn't removed,
  **Remote Control** in 13 px with "Use this session from claude.ai or the Claude app" in `fg-3`
  under it, and a switch on the right. Hovering the row shows "Follow and steer this session from
  claude.ai or the Claude app on any device signed in to your account. Turning it off restarts
  Claude Code in the same conversation.", or why the switch is disabled: "Wait until the session
  needs you to turn Remote Control off" while **Running** with it on, and "Claude is asking you
  something. Answer it in the terminal first." while Claude asks with it off. The reason also
  replaces the line under the name, so it shows without hovering, and screen readers hear it as
  the switch's description; otherwise they hear the line and the restart sentence. Clicking the
  name flips the switch. On a live session, turning it on types
  `/remote-control`; turning it off restarts Claude Code in the same conversation, which comes back
  as **Needs you**, or **Done** for a routine's session, without a notification. On a **Finished**
  session it only saves what **Resume** starts. It's disabled while it works, and a refusal shows
  under it in `danger`. On a ticket session, an **Automatic review** row follows in the same
  layout, with "Review the changes when Claude ends its turn with an open pull request" in `fg-3`
  under the name, also the switch's description. The switch starts from the project's
  **Automatic review** and saves the session's own choice. While an automatic review round runs,
  a `blue-soft` callout follows the switch, the look of **Callout on top** in the place of **Under
  the switch**, both picked from a prototype: `radius-card` corners, 12 px padding, 6 px gaps.
  It holds "Reviewing" in 13 px weight 500 `blue` after the pulsing 14 px `ScanSearch`, then
  "Round 2 of 3 · 4 changed files · started 14:02. High findings go to Claude when it ends." in
  `fg-3`, then, in the ticket view, a 24 px outline **Open Changes** button that opens the
  **Changes** tab. `blue` keeps 5.6:1 on it in light and 6.1:1 in dark, `fg-3` 4.8:1 in both. The
  callout shows while the session shows **Reviewing**, so it goes away when the round ends, when
  you send a message during the round, or when Claude asks you something.
- On **Running** (not **Done, session open**), the list row's activity pill follows that block at 24 px, as wide as its step
  and at most the panel's width, with the last steps in its tooltip.
- A `card` box with `radius` corners and 12 px padding follows it. It holds the **Context
  window** meter, its percentage in 13 px weight 500, with "92K of 200K" under it, or "Waiting for
  Claude's first reply" in `fg-3` before Claude Code has reported any. On a live session, the
  **5-hour limit** and **7-day limit** meters follow, each with its percentage and "Resets 16:00",
  or "Resets Mon 09:00" beyond today. A limit shows once Claude Code reports it, which it doesn't
  on an API key. A limit whose reset time has passed shows its label and "Reset at 16:00" in
  `fg-3`, with no meter, until Claude Code reports it again.
- Each meter is a 4 px pill on `surface-3` with a `fg-3` fill. From 80% for context and 90% for a
  limit, the fill is `amber` and "Nearly full" or "Near limit" shows under it in `amber`, so the
  word, not only the color, carries it. Each meter is a `meter` for screen readers, such as "46%
  used, 92K of 200K".
- From 80% context on a live session, an outline `xs` button sits under the context meter:
  **Prepare to compact**, which asks Claude to write its goal, decisions, changed files, open
  to-dos, and next step to a notes file in Sandtable's data folder, then **Compact** once that
  message is the latest, which types `/compact` keeping the notes file. A compaction or another
  message turns it back to **Prepare to compact**. While Claude works or asks, it's disabled, with
  "After Claude stops working" or "After you answer Claude" beside it in `fg-3`. After a click it
  stays disabled, with "Sent" or "Compacting…", until a reply, tool call, or compaction lands. A refusal shows
  under it in `danger`.
- Folded rows follow, each a chevron, its title in weight 500, and a summary in `fg-3` on the
  right, truncated. The chevron points right, and down while the row is open; an open row's
  contents sit 20 px in, each `fg-3` label beside its `fg-2` value, truncated, except in
  **Where**, whose values wrap anywhere so a long branch reads in full.
  - **This session**: the tokens, price, and elapsed time, such as "8.4M · $12.30 · 42m". It
    opens to the card's usage row with the token cap, then "Price" with Claude Code's own estimate
    when no model in the transcript has a price, **Elapsed**, **API time** (the time Claude
    spent on API calls), and **Compactions**, "1 · last at 14:05" or "None yet".
  - **Model**: the model, then the permission mode on a live session. The model is the one Claude
    Code reports, or the session's picked **Fable**, **Opus**, **Sonnet**, or **Haiku** until it
    reports one. It opens to **Model**, such as "<model> · high effort", and **Permissions**: **Default**, **Accept edits**, **Plan**, or
    **Bypass permissions**. With neither known, there's no row.
  - **Where**, open by default: "Worktree", "Worktree removed", or "Main checkout", then
    " · Sandboxed" when the session's record says it was sandboxed and it isn't removed. It opens to **Branch** in monospace for a worktree,
    **Repo** (or **Repos**), **Folder** (or **Folders**) in `fg-3` over each folder in monospace
    `fg-2`, wrapping anywhere, and, on the same terms as the summary, **Sandbox** with the quiet **Sandboxed** label: 11 px `fg-3`
    text, focusable, an image named by its tooltip, which lists the limits and the session's
    allowed domains. Under each folder, until the worktree is removed, **Open in Finder** and
    **Open in <editor>** as text links in a wrapping row; with more than one folder, their
    accessible names add the repo, such as "Open in Finder, shop". A failed open shows its message
    in `danger` under them.
  - **Work**, open by default: the files changed and the pull request, such as "3 files · #12 PR
    open". It opens to **Files** with lines added in `added` and removed in
    `danger`, a **Pull request** row per pull request from the branch, its number a link to GitHub
    and its stage word, and **Review findings**, the count of findings you kept, or "None". In the
    ticket view, on the latest session with a worktree, the file count and a nonzero findings
    count are `accent-bright` links that open **Changes**, closing the **Context** popover and
    moving focus to the **Changes** tab. On **Changes** itself, and in the session view, which has
    no **Changes**, they're plain text.
  - **Agents and tasks**, "N running", on a live session with subagents still running or
    background shells still open: each one's kind in monospace and what it's doing in `fg-3`.
    Hidden when there are none.
  - **Claude's to-dos**, open by default, "N of M" done, from Claude's latest to-do list: a done
    item is struck through in `fg-3` and the one in progress is weight 500 in `fg`, and each says
    so to screen readers. Hidden when there are none.
- On a finished session, "Finished" in `fg-3` comes after that block, and the panel leaves out the limits,
  the permission mode, and **Agents and tasks**. With no status left, as after its worktree is
  removed, it also leaves out the `card` box and the elapsed time.
- Under 900 px of panel width, and on the ticket view's **Details** and **Changes** tabs, the
  panel folds into the **Context** button in the view's header. On **Details** and **Changes**,
  where there's no conversation to switch, its popover leaves out the **View** switch. The button is a 24 px pill on `surface-3` in `fg-2` with a 24 px meter and "Context 46%", or "Session" with
  no meter before Claude Code reports any context. Its tooltip reads "Session details", and its
  accessible name adds that to its text, as "Context 46%, session details". Near a limit, it
  turns `amber-soft` with `amber` text, its meter `amber`, and reads "Context 84% · Nearly full"
  or "Context 46% · Near limit", judged on the rounded percentages the panel shows and never on
  a finished session's limits. It opens the panel in a popover aligned to its right edge.

## Session view

- The session view keeps the sidebar and has no tabs. Its header has **Back to board** (the
  ticket view's icon button), the session's name (truncated), and a pencil icon button labeled
  **Rename session**. On the right, in the [shared header layout](#layout): the state chip,
  **Clear Needs you** on **Needs you**, **Raise cap** while it's stopped at its token cap, the
  **Context** button under 900 px (see [Gauges panel](#gauges-panel)) while the session isn't
  removed, and, unless the session is removed, a rule and the
  actions: **End session** and, for a worktree,
  **End session and remove worktree** while the session is live; **Remove from list** (main
  checkout) or **Remove worktree** (worktree) once it's finished;
  nothing once it's removed. Last comes, for a session without a ticket that isn't removed, **More
  actions** with **Save as routine**, which opens the
  [routine editor](#routine-editor) with the session's repo, place, and first message; at narrow
  widths the outline actions fold into the same menu (see **Narrow widths**). Buttons are 28 px, **Rename session** included, except the 20 px
  **Clear Needs you** and **Raise cap**. While one
  of them works, all of them are disabled.
- The conversation's find bar opens on ⌘F whenever the session view shows the **Conversation** view (see
  [Conversation](#ticket-view)).
- **Rename session** turns the name into a 240 px field; Enter saves, and Escape cancels and
  clears any error. An empty name shows "Enter a name".
- Removing either kind, with **Remove from list** or **Remove worktree**, takes the session off
  the sidebar and the **Sessions** strip. **Resume** on a session whose folder is gone shows
  "The session's folder is gone. Remove it from the list."
- Under the header, results such as "Removed from list" or "Worktree removed" show in an 11 px
  `fg-2` line, and errors in `danger` on `danger-soft`, as in the ticket view, including the
  failed-fetch line while the session is live and the early-exit line once it's finished.
- The session's [conversation](#ticket-view) fills the rest, as on the ticket view's
  **Conversation** tab, with the [Gauges panel](#gauges-panel) on its right, but without the
  toolbar line. On a finished session, a primary small **Resume** sits centered where the
  composer was. A removed session shows a centered message instead, "Session removed" / "It's no
  longer listed."

### New session dialog

- **New session** opens a dialog, "New session in <project>", with "Runs Claude Code with no
  ticket. Leave the first message empty to type it in the terminal." With more than one repo, a **Repo** group lists the
  project's repos as radio boxes. A **Where** group holds two radio boxes, like the add-project
  flow's: **Main checkout** (the default, "Runs in <path>, the folder you also work in, so it can
  change your files there.") and **New worktree** ("Gets its own branch and worktree, for changing
  code."). Then **First message**, a textarea with the placeholder "Optional", up to 240 px tall.
  Between **Where** and **First message**, a **Model** group: a segmented control, the
  **Appearance** toggle's shape at the dialog's full width, with Account default, Fable, Opus, Sonnet,
  and Haiku, each segment as wide as its name with the spare width shared out, set to the project's model. The choice applies only to this session.
  Group headings are 11 px, weight 500, in `fg-2`.
- The footer has a ghost **Save as routine** on the left, which closes the dialog and opens the
  [routine editor](#routine-editor) with its repo, place, and message, then **Cancel** (outline)
  and **Start**. While it works, **Start** reads "Starting",
  every button is disabled, and Escape or a click outside doesn't close the dialog.
- A **New worktree** start with a [worktree setup](#worktree-setup) shows its block above the
  footer while it runs. The block's **Cancel** stops it and removes the worktree if it's clean.
  A failed setup keeps the worktree: **Start anyway** starts without setup with the choices the
  failed start used, even if you changed them since, and the block's **Cancel**, the footer's
  **Cancel**, or closing the dialog removes the worktree if it's clean. **Start** is disabled
  while the failed block shows. Any other failure shows "Couldn't start: <message>" in `danger` above the footer, and a
  worktree the start made is removed if it's clean. A failed folder check names the repo whose folder is missing or no
  longer points at it; you fix it with **Edit project**. **Start** opens the session view.

### Routines section

- The section shows even when the project has no routines: the 11 px `fg-2` heading "Routines"
  with the count in `fg-3`, "0" included, then a wrapping row of pills 6 px apart that ends with
  **New routine**. A failed start shows "Couldn't start <name>: <message>" in an 11 px `danger`
  line under the row until the next start.
- A pill is 24 px tall with `radius-full` corners, a `surface` fill (`card` on hover), and a 1 px
  `line-2` inset ring. Its start button holds a 12 px `Play` icon in `accent-bright`, the name in
  `fg-2`, and, for a scheduled routine, a 12 px `Clock` in `fg-3` named with its schedule, such as
  "Runs weekdays at 02:00". The clock stays in every state, before the state word. A
  click starts a run, a new session named after the routine and its start time, such as
  "Dependency check, Oct 28, 02:00"; it shows in **Sessions** and the sidebar, and the board
  stays. Its tooltip and accessible name are "Start <name>". For a scheduled routine, every
  tooltip and accessible name of its start button ends with its schedule sentence, such as "Start
  Nightly deps. Runs weekdays at 02:00."
- While a click starts it, the pill drops any session state, **Starting** in 11 px `fg-3` follows the name, the button is
  `aria-disabled`, a second click starts nothing, and its tooltip and accessible name are
  "Starting <name>". A routine in a worktree runs the repo's worktree setup first, so the pill
  reads **Starting** until the setup finishes, up to 10 minutes plus copying.
- While the routine's last session is open, the pill shows that session's state as its chip does:
  its icon, and its word in 11 px `fg-3`. At **Running** the pill takes
  `blue-soft` with a `blue` ring at 40% and the icon and name in `blue`; at **Needs you**,
  `amber-soft` with them in `amber`; at **Idle**, `neutral-soft` with them in `fg-2`; at **Done**,
  `added-soft` with them in `added`. Except at **Done**, the button is `aria-disabled`, a click
  starts nothing, and its tooltip and accessible name are "<name>'s last session is still open";
  at **Done** a click starts the next run, and its tooltip and accessible name are "Start <name>.
  Its last run is done." With two open sessions, the pill shows the one that holds the next run,
  or else the newer one. Icons in a pill other than the clock are hidden from assistive tech.
- A 12 px `ChevronDown` in `fg-3` (`fg` on hover) ends the pill, named "More for <name>". It opens
  a menu with **Edit routine** (`Pencil`), which opens the [routine editor](#routine-editor),
  **Copy to project…** (`Copy`), a submenu of every project by name that opens that project's
  routine editor filled from the routine, and **Run history** (`History`).
- **New routine** is a pill with a 1 px dashed `line-2` border, no fill, and a 12 px plus and the
  words in `fg-3`; on hover it takes the `card` fill, a `fg-4` border, and `fg-2` text. Its tooltip
  reads "Save a way to start a session in one click or on a schedule", and it opens the routine
  editor.
- **Run history** opens a side panel built like **To clean up**: 420 px from the right edge, a
  44 px header with "<name>: run history" and a ghost icon **Close**. The history loads each time
  it opens and reads "Loading" in 11 px `fg-3` until it does; a failed load shows "Couldn't read
  the run history: <message>" in 11 px `danger`. Under the header, a 12 px by 16 px line in 11 px `fg-2` with a `line` rule under it gives
  "N runs", "N skipped", and, when any run has a price, "$N API estimate" for them all. Then one
  row per run, newest first, 8 px apart: `radius-card`, 12 px by 10 px padding, and a `line`
  inset ring, with the `card` fill for a session and none for a skip.
  - The top line has the time ("Oct 27, 14:00"), then the session's state chip or **Skipped**, a
    chip with a `Clock` icon in `fg-3` and a `line-2` ring, and, for a session that isn't removed,
    an outline **Open** pushed right that opens the session view.
  - An 11 px `fg-3` line follows: **On schedule** or **Started by you**, then, for a session,
    "main checkout" or the branch in monospace and its usage ("1.5K tokens · $1.25 API
    estimate", with "*" after the amount when it leaves out a model with no price, or the tokens
    alone when no model has one).
  - For a session stopped at a prompt, "Waiting on" and the tool in
    monospace, such as `Bash(npm outdated)`, in `amber`.
  - A session's start warning, as on a ticket card, in `danger`.
  - Last, Claude's last message in `fg-2`, cut to two lines, or, for a skip, why in `fg-3`:
    "Sandtable was closed or the Mac was asleep", "Its last session was still open", or "Couldn't
    start: <message>" for a scheduled start that failed. With no runs it says "No runs yet" in
    11 px `fg-3`.

### Routine editor

- A dialog laid out like New session: "New routine in <project>" or "Edit <name>", with "Starts a
  session without a ticket with this first message, in one click or on a schedule." Its fields,
  in order: **Name**; **Repo**, with more than one repo; **Where it runs**, the same two radio
  boxes and help as New session's **Where**; **First message**, a textarea up to 240 px tall;
  **Allowed without asking**, a two-row monospace textarea up to 160 px tall with the placeholder
  "Bash(npm outdated)" and "One permission rule per line, such as Bash(npm audit:*). Only this
  routine's sessions use them without asking." in 11 px `fg-2` under it; and
  **Run on a schedule**, a switch, off for a new routine, with "Starts while Sandtable is open and
  the Mac is awake. A time it misses is skipped." in 11 px `fg-2` under it. Headings are 11 px,
  weight 500, in `fg-2`, apart from the switch's label, 13 px at weight 500 in `fg`. When the
  routine's repo is no longer in the project, the editor picks the project's first repo. A copy
  from **Copy to project…** whose repo the project lacks starts with no repo picked when the
  project has two or more, and **Save** or **Build with Claude** then shows "Pick a repo".
- With the switch on, seven 24 px pill toggles follow, Monday first, each showing its short day
  name and named by its full one, with Monday to Friday pressed on a new routine. A pressed day
  is `neutral-soft` with `fg` text at weight 500, an unpressed one `fg-3`, each in a `line-2`
  ring.
  Beside them, a 28 px **Time** field, `02:00` on a new routine.
- The footer has **Cancel** and **Save and start** (outline) and **Save**. **Save** saves and
  closes; **Save and start** also starts a run, and the view behind stays where it is. While it
  works, the busy button reads "Saving" or "Starting", every button is disabled, and Escape or a
  click outside doesn't close the dialog. A failure shows "Couldn't save: <message>" (or
  "Couldn't start:", once saved, or "Couldn't delete:") in `danger` above the footer and keeps the
  dialog open. A name over 200 characters reads "Shorten the name", and a first message over
  10,000 bytes "Shorten the first message". A rule that isn't permission syntax reads "<rule>
  isn't a permission rule. Write a tool such as Read, or a tool and what it may do, such as
  Bash(npm outdated)", and `Bash`, `Bash(...)` with only `*`, `:`, and spaces inside, or a `Bash(...)` wildcard whose command before the `*` is a known runner of other commands (a shell, `env`, `xargs`, `sudo`, `nice`, an interpreter such as `node` or `python3`, `npx` and its kin, or a package manager such as `npm` or `pnpm` on its own), in any letter case or as a full path, optionally with flags such as `-c`, numbers such as `5`, `NAME=value` words, and further runners after it, "<rule> lets the session run any command. Name the
  commands, such as Bash(npm outdated)".
- The dialog is 880 px wide and up to 640 px tall, with no padding of its own: the form keeps a
  448 px column on the left that scrolls, with the error line and footer under it, and a **Build
  with Claude** chat fills the right in the `window` fill with a `line` border on its left; the
  dialog's `line-2` ring runs around both halves, so the chat's darker fill keeps a clear outer edge. Its
  40 px header has the title in medium weight and, once there are messages, a ghost xs **Start
  over**, which clears the chat, the chips, and Claude's suggestions without asking and keeps the
  fields; the dialog's close button sits over the header's right end. Claude reads the repo picked
  when you send the first message, and after **Start over** the next first message reads the repo
  picked then. While Claude answers, **Save** and **Save and start** are disabled. An empty chat centers "Describe the routine" over "Claude
  reads the repo's code, asks what it needs, and fills in the fields. Nothing is saved until you
  click Save." A copy whose repo isn't the original's centers a 340 px `amber-soft` box instead,
  `radius-card` with 16 px padding and a 14 px `TriangleAlert` in `amber`: "Written for <project>"
  in `fg` at weight 500 over, in `fg-2`, "Its commands and allowed rules come from <repo> and
  might not work in <picked repo>. Send the message to have Claude fit them.", repos in monospace.
  With no repo picked it reads "…might not work in this project. Pick a repo, then send the
  message to have Claude fit them." Its message box starts as "Fit this routine to <picked repo>:
  check its first message and allowed rules against this repo's code.", empty until a repo is
  picked, and follows the picked repo until you type in it or Claude answers; **Start over** brings the
  warning and the request back when the message box is empty. Messages, the working line, **Stop**, errors, and the composer, with the
  placeholder "Describe what the routine should do" and **Send**, look like the ticket chat
  panel's, and Enter sends. A reply that changed fields ends with "Changed: <fields>" and, for
  fields you edited and for allowed rules, "Suggested: <fields>", in 11 px `fg-3`, and a proposed repo the project
  doesn't have adds "Not in this project: <repo>". After a reply, a failed turn, or **Start
  over**, the focus is back in the message box.
- A field the latest reply changed shows a neutral chip, "Changed by Claude", beside its heading,
  until you edit it. Only what a reply changes from the fields it was sent with counts, so an edit
  made while Claude answers stays. A field you edited keeps your value, and Claude's shows 6 px
  under it in an 8 px `card` box: "You edited this field. Claude suggests:", the value (monospace
  for the rules, with the refusal in `danger` when they would be refused), then **Use Claude's**
  (outline, xs) and **Keep mine** (ghost, xs). Claude's allowed rules always wait for **Use
  Claude's**, even in an empty field, whose box reads just "Claude suggests:". **Use Claude's**
  fills the field and shows its "Changed by Claude" chip. A later reply that no longer proposes a
  different value drops the box.
  While a rule in **Allowed without asking** would be refused, the refusal replaces the field's
  help line in `danger`.
- Editing adds a ghost **Delete routine** in `danger` on the left, which asks "Delete <name>?"
  with "The sessions it started stay. Its skipped times are deleted." in an alert dialog with
  **Cancel** and a
  destructive **Delete**.

### New ticket composer

- Clicking the **New ticket** placeholder turns it into a composer card in its place, a form
  named "New ticket": the `card` fill, `radius-card` corners, and a 1 px `line-2`
  inset ring that turns `focus` while a field in it holds the focus, with 12 px padding and 6 px between rows. It enters with opacity and a 6 px rise
  over 200 ms on `ease-out-cubic`; under reduced motion it only fades.
- Top to bottom: a borderless **Title** input, placeholder "Issue title" in `fg-4`, which takes
  focus; a borderless three-line **Description** text area in `fg-2`, placeholder "Add a
  description…", which grows with its text up to 240 px and then scrolls; with more than one repo,
  a **Repo** radio group of pills, each repo's short name in 11 px `fg-3` inside a 1 px `line-2`
  ring, the chosen one on `neutral-soft` in `fg`, the first repo chosen by default. When two repos
  share a short name, both show their full `owner/name`. The group is one tab stop, and Left and
  Right Arrow move between repos. On a Linear project the group is **Linear project** instead,
  shown when the project has more than one Linear project, each pill a Linear project's name. On a
  Jira project there's no group; the issue goes to the project.
- The footer has **Draft with Claude** (outline, with a sparkles icon), "Esc to cancel" in 11 px
  `fg-3`, and **Create**, both 28 px. Enter in **Title** creates the issue; Escape cancels, puts
  the placeholder back, and focuses it. Escape during an IME composition only ends the
  composition. A click outside does nothing, so what you typed stays.
- While **Create** works it reads "Creating", both buttons are disabled, and Escape does nothing.
  Once the issue exists, the composer clears and stays open with **Title** focused for another,
  and a status line in 11 px `fg-3` above the footer says "Created <repo>#<n>", or on a Linear
  or Jira project "Created <key>", such as "Created ENG-40", which screen readers announce politely. The card arrives with the sync that follows.
- **Draft with Claude** starts the drafting session in the picked repo, or, on a Linear or Jira
  project, in the project's first repo, filing in the picked Linear project or the Jira project, seeded with what you typed,
  and opens its session view, named "New ticket". While it starts it reads "Starting", both buttons
  are disabled, and Escape does nothing. If the composer closes first, such as when you leave the
  board, the session view doesn't open.
- A failure shows "Couldn't create: <message>" or "Couldn't start: <message>" in 11 px `danger`
  above the footer, such as "Couldn't create: Enter a title", as an alert that screen readers
  announce at once. Picking another repo or Linear project clears it.
- Opened from **Add sub-issue**, the composer is a form named "Add sub-issue" that starts with
  "Sub-issue of <#n or key>" in 11 px `fg-3`, the number or key in monospace, above **Title**,
  and has no **Draft with Claude**. On GitHub it has no repo group, since the issue goes to the
  parent's repo; on Linear the **Linear project** group stays, and the issue goes to the Linear
  project you pick, the first by default. **Create** files the issue with its parent set in the
  same call, and its row arrives with the sync that follows.
- A failure after the issue exists shows the message without the "Couldn't create:" prefix,
  naming the issue: "Created <repo>#<n>, but couldn't put it in <to-do status> on the board:
  <reason>" or "Created <repo>#<n>, but couldn't refresh the board: <reason>". A Linear or Jira
  project only shows the refresh failure, naming the key. **Close** takes the
  place of **Draft with Claude** and **Create**, so you can't file the issue twice, and **Title**
  and **Description** turn read-only. **Close** puts the placeholder back and focuses it.

## Settings

- **Settings** in the sidebar footer and **Sandtable > Settings…** (Command+Comma) open Settings in place of the main view (board,
  ticket, session, or add-project flow), with the sidebar beside it. Over the setup guide it takes
  the guide's place in the panel. The view behind it stays as you left it, and it isn't saved as the last view, so a
  restart opens where you were before it.
- The header has a ghost 28 px icon button labeled **Back**, with an arrow icon, then **Settings** as the title. **Back**
  returns to the previous view; choosing anything else in the sidebar or clicking a notification also
  leaves it.
- Under the header, the body scrolls. Each group of settings is a section up to 520 px wide with
  24 px margins: a weight-500 heading that names the setting, then a row on a `card` surface with
  `radius-card` corners: the setting's text on the left and the control on the right.
- **Appearance** is a 224 px three-way toggle, **System**, **Light**, and **Dark**, on a
  `surface-3` track, described as "**System** follows macOS." The pressed choice is `surface`
  with `fg` text and a 1 px `line-2` inset ring; the others are `fg-2`. Clicking the pressed choice
  keeps it.
- **Sleep** has a row whose left side is **Keep your Mac awake while sessions run** in `fg`,
  with an 11 px `fg-2` helper line under it: "With the lid closed, this works only when your Mac
  is on power and connected to a display." The control on the right is a switch, off by default:
  a `primary` track when on and `fg-4` when off (`input` in dark mode), whose track color changes over 100 ms ease-out
  and whose thumb slides over 150 ms ease-out, or jumps with reduced motion.
- **Remote Control** has one row in the **Sleep** style: **Start sessions with Remote Control
  on**, with the helper "Follow and steer sessions from claude.ai or the Claude app. A project can
  override this in Edit project." Its switch is off by default.
- **Claude Code accounts** departs from the one-row-per-section pattern: under the heading, an
  11 px `fg-2` lede, "You pick one for each project when you add or edit it. Default is the
  account Claude Code uses on its own.", then one `card` per account, **Default** first.
  - An account's card has the name in `fg` with its folder under it in 11 px monospace `fg-2`
    (`~` for the home folder, truncated, the full path on hover), then the sign-in word in 11 px
    `fg-2`: "Checking…", **Signed in**, **Not signed in**, or **Can't check**. Every account but
    **Default** ends with an outline small **Remove**. The words are checked again whenever the
    window gets focus.
  - **Not signed in** adds the setup guide's command box under the row, 12 px below it, with
    `claude auth login` for **Default** and `CLAUDE_CONFIG_DIR=<folder> claude auth login` for the
    others.
  - A failed load, add, or remove shows its message in `danger` on `danger-soft` with `radius`
    corners, under the cards. **Remove** on an account a project uses shows "<projects>
    uses <account>. Pick another account for it first." ("use" and "them" for more than one).
  - Under it, an outline small **Add account** opens a form on a `card` in its place: a **Name**
    field, focused, and a monospace **Folder** field with the placeholder "~/.claude-work". When
    your home folder has `.claude*` folders that aren't accounts yet, a row of outline extra-small
    (24 px) monospace buttons follows, one per folder, shown with `~`. A button fills **Folder**,
    and fills **Name** with the part after `.claude-` while **Name** is empty or still holds the
    name the last button filled. The form ends with a ghost small **Cancel** and a primary small
    **Add**, right-aligned; **Add** and **Remove** are disabled while one works. The add errors
    are "Enter a name", "Enter a folder", "Enter a full path, starting with / or ~/", "An account
    named <name> already exists", "<account> already uses <folder>", and "<folder> can't be an
    account's folder. Use a folder such as ~/.claude-work." for the home folder or `/`.
- **Leftover sessions** follows the **Claude Code accounts** pattern: an 11 px `fg-2` lede,
  "Sessions and worktrees that no card or sidebar row shows, and those of done tickets. Nothing is
  ended or removed until you click.", then one `card` that holds every leftover as a row, with a
  `line` rule between rows. The board's **To clean up** panel
  shows the same list, with **Clean up all** in its header.
  - It lists the sessions no card or sidebar row shows, and the newest session of each ticket in
    **Done** while that session runs or its worktree is on disk, unless it has finished and a
    shown session of another ticket or another project uses that worktree.
  - With two or more rows, an outline **Clean up all** sits above them. It opens a
    confirmation titled "Clean up <n> sessions?" with the text "This ends running sessions and
    removes their worktrees. A worktree with uncommitted or unpushed changes stays, and its row
    says why.", **Cancel**, and a destructive **Clean up**. **Clean up** runs each row's own action in turn,
    reads **Cleaning up** while it works, disables every button until it finishes, and shows
    each row's refusal or error on that row; one failure doesn't stop the rest.
  - Rows sort by why they're left over: **Done**, then **Off the board**, then **Removed
    project**, then unknown sessions.
  - A session's row has two lines. The first has its ticket key or name in `fg`, the ticket's
    title in `fg-2` when the project's last sync has the ticket, in any column, and its state chip
    at the end, **Done, session open** for a live session of a done ticket. The second, in 11 px
    `fg-2`, starts with the reason in medium `fg`, then the project's name, the repo, and the
    branch in monospace, joined by " · ". The reason is **Done** for a ticket in **Done**,
    **Removed project** when the project is gone, which then replaces the project's name, and
    **Off the board** otherwise. The key or name keeps up to 70% of the line and the title
    truncates first; on the second line, every part truncates on its own, and the branch keeps at
    least 96 px. A ticket key shows in monospace. A tmux session that this Sandtable started and
    has no record of reads **Unknown session** in monospace, with no chip and its tmux name under
    it in 11 px monospace `fg-2`; another Sandtable's sessions never show.
  - Each row ends with one ghost 28 px icon button at its top: a `Trash2` for **End session and
    remove worktree** on a live session and **Remove worktree** on a finished one, and a `Square`
    for **End session** on an unknown one or a live one whose worktree a card still uses, which
    keeps the worktree. Its accessible name is the action, and its tooltip is the action and what
    it does to your work: "Ends the session and removes its worktree.", "Removes the worktree.",
    each followed by "A worktree with uncommitted or unpushed changes stays."; "Ends the session.
    Its worktree stays, because a card still uses it."; or "Ends the tmux session. Sandtable has
    no worktree on record for it." While it works, it shows a spinning `LoaderCircle` and its
    name is **Ending session** or **Removing**, and every button is disabled until it finishes, even
    when the list reloads meanwhile. A refused removal shows its reason in 11 px `danger` under the row; a failed load
    or action shows in `danger` on `danger-soft` under the list.
  - With nothing left over, the section reads "None. There is nothing to clean up." in `fg-2`.
  - The list loads when Settings opens, after each action, and whenever the board changes.
- **Notifications** has five rows. Three have a switch in the **Sleep** style: **Notify when a
  session needs you**, with the 11 px `fg-2` helper "Cards still show **Needs you** when this is
  off."; **Play a sound**; and **Don't notify while Sandtable is in front**. While **Notify** is
  off, **Don't notify while Sandtable is in front** is disabled at 50% opacity, and so is **Play a
  sound** while the plan-limit row is **Off** too. The fourth row, **Notify when a plan limit
  passes**, has a 96 px select on the right with 50% to 95% and **Off**, 80% by default, and the
  helper "For the 5-hour and 7-day limits, once per window, even while Sandtable is in front." The
  last row reads "Banners, alerts, and the lock screen are set in macOS." in `fg-2`, with an
  outline small **Open Notification Settings** button on the right. If System Settings doesn't open, its error shows under the rows
  in `danger` on `danger-soft`.

## Usage

- **Usage** in the sidebar footer opens Usage in place of the main view, with the sidebar beside
  it, the way Settings opens; the view behind it stays as you left it. Choosing anything else in
  the sidebar, opening Settings, or clicking a notification leaves it.
- The header has a ghost 28 px icon button labeled **Back**, with an arrow icon, then **Usage** as
  the title. **Back** returns to the previous view.
- While it reads the transcripts: the spinner and "Reading transcripts…" in `fg-2`. When reading
  fails, "Couldn't read token use: <message>" in `danger`. With no use in any project, "No token
  use yet" in `fg-2`.
- The body has two panes. The left is 260 px wide with a 1 px `line` right border and 8 px
  padding, and scrolls. It's a list of buttons: **All projects** first, then each project with
  use, most tokens first. Each button has 8 px padding and `radius` corners, `surface-3` on hover,
  and the selected one is `surface-3` with a 1 px `line-2` inset ring. A row reads:
  - The project's 18 px tile and name (truncated), as in the sidebar, or "All projects", with the
    compact tokens on the right, the full count on hover.
  - For a project, a 4 px rounded bar of its share of all use (`fg-3` on `line-2`, hidden from
    screen readers), then in 11 px `fg-3` "49% of all use" ("<1%" for a share that rounds to 0)
    and its API price estimate on the right.
- The right pane scrolls with 24 px padding, up to 560 px wide: the entry's name as an 11 px `fg-3`
  heading, then the ticket view's **Usage** (total, working time, token types, **By model**, and
  the estimate box) for that entry, then an 11 px weight 500 `fg-3` **By week** heading. One row per week with
  use, newest first, with a 1 px `line` rule between rows: "This week", "Last week", or "Oct 12 –
  Oct 18", with the year for a week outside the current year ("Oct 12 – Oct 18, 2025", or "Dec 29,
  2025 – Jan 4, 2026" across New Year; weeks start on Monday, local time); a 6 px rounded bar of
  the week's tokens against the largest week (`fg-3` on `line-2`, hidden from screen readers);
  the compact tokens; Claude's working time that week in `fg-2`, "2h", read as "Claude worked 2
  hours" by screen readers, or empty when Claude ran no turn; and the API price estimate. A week
  with working time and no tokens still shows. The label, tokens, working time, and estimate
  columns fit their widest row, and the bar takes the rest.
- After **By week**, an 11 px weight 500 `fg-3` **Throughput** heading, then "Tickets whose pull
  request merged after a session started on them, counted when Sandtable syncs them in Done, by the
  week they merged." in 11 px `fg-3`.
  One row per week a ticket merged in, newest first, with a 1 px `line` rule between rows: the week
  label, as in **By week**, then the figures in two columns, each an 11 px `fg-3` label over its
  number in tabular figures: **Merged** ("2"), **Start to merge** ("14h median · 1d 2h slowest";
  "under 1m" under a minute, minutes under an hour, hours under a day, then days and hours; screen readers hear it in words,
  "14 hours median, 1 day 2 hours slowest"), **Per ticket** (the API price
  estimate divided by the tickets merged, shown only when a model has a price), and **Needs you per
  ticket** ("1.5", up to one decimal). With no merged ticket for the entry, "No tickets merged from a
  session yet" in `fg-2`. Every figure is a number with its label; nothing is a chart or a color.
- An estimate shows only when a model in it has a price. One that leaves out a model with no price
  ends in `*`, which screen readers read as "leaves out a model with no price". When a week row or
  throughput row shown has such an estimate, "\* Leaves out tokens from a model with no price." in
  11 px `fg-3` follows **Throughput**.
- A selected project that no longer exists falls back to **All projects**.

## Add project

- **Add project** and **Edit project** open the flow in the main area; the sidebar stays. The
  header reads "Add project" or "Edit <name>", followed
  by "Step N of 4" in 11 px `fg-2`.
- A 220 px progress rail on the left lists the four steps: **Name**, **Tickets from**, **Repos**,
  and **Review**. Each has a 20 px circle with its monospace number, the step name, and an 11 px
  `fg-2` summary under it:
  - Current step: `surface-3` background, an `fg` circle outline, and "Current step".
  - Finished step: an `fg` circle with a check, and its value: the name, "Repo issues", "Board,
    statuses chosen", "Linear team <KEY>", "Jira project <KEY>", or "N repos". **Review**, once reached and complete, reads "Ready to save".
  - Visited step with a problem: the problem, such as "Enter a name".
  - Step not reached: "Not started", in `fg-3`, disabled.
    You can jump to any step you've visited when every step before it is complete.
- The content column is up to 600 px wide with 32 px and 40 px padding: an 18 px heading, a
  `fg-2` lede, then the step. A footer holds **Back** (ghost, from step 2 on), a hint that names
  what blocks the step, **Cancel** (outline), and **Continue**, or **Save** on the last step
  ("Saving…" with a spinner). The primary button is disabled while the hint shows. Each step
  focuses its first field. **Cancel** returns to the board and is hidden when there's no project to return to; **Save** opens the saved
  project's board. A failed save shows "Couldn't save the project: <message>" in `danger` on
  `danger-soft` above the footer, and a failed delete "Couldn't delete the project: <message>".
- Hints: "Enter a name", "Choose where tickets come from", "Loading the board…", "Load the
  board", "Choose a board status for <column>", "Loading workspaces…", "Load the Linear workspaces", "Loading teams…", "Load the Linear teams", "Choose a team", "Choose a Jira account", "Loading Jira projects…", "Load the Jira projects", "Choose a Jira project", "Load the board first", "Include at least one
  repo", "Add at least one repo", "Checking remote…", "Choose a folder for <repo>", and, on Review, "Shorten your instructions to
  3,000 bytes" while the every-ticket text and each kept label and its text add up to more.
- **Name the project** ("Shown in the sidebar and the board header."): a **Name** field with the
  placeholder "Acme". Enter continues.
- **Where tickets come from** ("A GitHub Projects board, the issues in the project's repos, a
  Linear team's issues, or a Jira project's issues."): four radio boxes, **GitHub Projects board** ("Tickets and columns come from the board's Status
  field.") and **Repo issues** ("Each repo's issues are the tickets. Open issues are To do, or In
  progress with Sandtable's label, which Start adds and dragging changes; closed issues are
  Done."), and **Linear team** ("Tickets are a Linear team's issues. Columns follow each issue's
  workflow state: unstarted is To do, started is In progress, completed is Done; canceled,
  backlog, triage, and duplicate issues stay hidden."), and **Jira project** ("Tickets are a Jira
  project's issues. Columns follow each issue's status category."). The boxes are `fg` at 5% over what's behind them, so they
  read on the page and in a dialog; a hovered or selected box is `fg` at 8%, and the selected one
  has a filled radio dot. The arrow keys move between the boxes of a group.
  - With a board: a monospace **Board URL** field (placeholder
    "https://github.com/users/you/projects/1") and **Load board**, which reads **Reload** once
    loaded; Enter loads. The status line reads "Loading board…" with a spinner, then "Board
    loaded: tickets from N repos" with a check. Errors: "Enter a board URL such as
    https://github.com/users/you/projects/1", or "Couldn't load the board." with "GitHub says
    <owner>/projects/<n> doesn't exist, or your token can't read it." when GitHub can't find the
    board, or with GitHub's own message otherwise, such as "GitHub CLI is not logged in; run
    `gh auth login`", and **Try again**.
  - Once loaded, **Board status for each column** shows three selects, **To do**,
    **In progress**, and **Done**, preset to "Todo", "In Progress", and "Done" when the board has
    them, otherwise "Choose". Editing the URL clears the loaded board and drops every repo
    except the included ones that have a folder.
  - With a Linear team: choosing it loads the workspaces once, with "Loading workspaces…" and a
    spinner, or "Couldn't load the Linear workspaces." with the reason and **Try again**. When
    the CLI is signed in to no workspace, the load fails with the CLI's reason, which says to run
    `linear auth login`. A **Workspace** select follows, each as "<organization> (<slug>)", set to
    the project's saved workspace or else the CLI's default one. A saved workspace you're no
    longer signed in to falls back to the default one and clears the team. It loads that workspace's teams, with "Loading
    teams…" and a spinner, or
    "Couldn't load the Linear teams." with the reason and **Try again**. Then a **Team** select,
    each team as "<name> (<KEY>)", and, once a team with projects is chosen, **Linear projects
    (optional)**, a checkbox per project, with "Leave all unchecked to show the whole team."
    Changing the workspace clears the team and projects and loads its teams; changing the team
    clears the projects; changing the source clears the team and projects. Editing a Linear
    project loads the teams to show the saved team and projects; once they load, projects the team
    no longer has are dropped, and a team that's gone reads as not chosen. If the load fails, the
    saved team and projects are kept and saved.
  - With a Jira project: **Jira account**, a radio box per saved account with its site in
    monospace over "<email> · token encrypted on this Mac", after "Loading Jira accounts…" and a
    spinner while they load, or "Couldn't read the saved Jira accounts." with the reason and **Try
    again**, then a ghost **Add a Jira account…**. The account boxes are disabled while
    Jira checks a new one. With no
    saved account, or after **Add a Jira account…**, an inset `card` form shows **Jira site**
    (monospace, placeholder "yourteam.atlassian.net"), **Atlassian email**, and **API token** (a
    masked monospace field, placeholder "Paste a token from id.atlassian.com", with "Sandtable
    keeps it encrypted with a key from your macOS Keychain and reuses it for every project on this
    site."), then **Add
    account**, disabled until all three are filled and reading "Signing in…" while Jira checks
    them, and a ghost **Cancel** when there are saved accounts. Enter in any field adds. A refusal
    shows in the form as a `danger` alert: for a wrong email or token, "Jira didn't accept that
    email and API token. Use the email of the Atlassian account that made the token.", and
    otherwise Jira's own message. Adding an account for a saved site replaces
    it. Picking or adding an account loads its projects, with "Loading Jira projects…" and a
    spinner, or "Couldn't load the Jira projects." with the reason and **Try again**; then a
    **Filter projects** field over a scrolling list of radio boxes, each the project's name over
    its key, with "No project matches." when the filter hides them all, or "No projects on this
    site." in place of the field and list when the site has none. Adding an account moves focus to
    **Filter projects** once its projects load. Leaving the Jira source closes the account form.
    Once a project is chosen, its boards load ("Loading Jira boards…", or "Couldn't load the Jira
    boards." with **Try again**): **Jira board**, with "Sandtable shows what the board shows: its
    active sprints, or, on a board without sprints, everything outside its backlog.", a radio box per board and **No board (show every issue)**; the
    only board is chosen for you, and with several the hint reads "Choose a Jira board". A project
    with no board says "This project has no board, so Sandtable shows every issue."
    Editing keeps the saved account, project, and board, also when the projects or boards fail to
    load; a project the site no longer lists reads as not chosen, and a saved board the project no
    longer lists does too unless it has only one.
  - Editing shows the
    saved statuses and repos without loading the board; **Reload** fetches it and keeps saved
    repos that are no longer on it. Switching between the boxes keeps the included repos and their
    folders, but a board must be loaded again and a Linear team chosen again.
- **Repos and folders**:
  - With a board ("Include the board's repos you work on, then pick the local folder for each.
    Sessions start in these folders."): the help line "Repos found among this board's tickets.
    Only tickets from repos you include show on the board.", then a box per repo with a checkbox,
    the monospace repo, and "Included" or "Not included". An included repo shows its
    folder row.
  - With repo issues, a Linear team, or a Jira project ("Add each GitHub repo, then pick its local
    folder. Sessions start in these folders.", then for a Linear team "Linear doesn't know about
    repos, so Start asks which one when it can't tell from a repo:<name> label or the issue's last
    session." and for a Jira project "Jira doesn't know about repos, so Start asks which one when it
    can't tell from a repo:<name> label or the issue's last session."): a box per repo with **Remove** and its folder row, or "No repos yet.", then a
    monospace field (placeholder "owner/name") with **Add repo**; Enter adds. Errors: "Enter a
    repo as owner/name, such as acme/api." and "<repo> is already in this project."
  - Both end with **Add from a folder…** ("Picks the repo from the folder's remote"). Its errors:
    "This folder has no GitHub remote, so Sandtable can't tell which repo it is." and, with a
    board, "No tickets on this board come from <repo>.", each with the folder's path. A repo
    found this way shows "Filled in <repo> from the folder's remote." When the folder's remotes
    point at more than one usable repo, a box says "<path> has remotes for several repos. Choose
    the one to add." with a button per repo.
  - A folder row shows the folder icon and the path in monospace (`~` for the home folder, the
    full path on hover), or "No folder chosen" in `fg-2`, and **Choose folder…**, which reads
    **Change folder…** once a folder is set. The button opens the macOS folder dialog
    (`dialog.showOpenDialog` with `openDirectory`); closing the dialog without a folder changes
    nothing. The check then shows "Checking remote…" with a spinner, and passes with a neutral
    chip, "Remote matches", with a check; a folder carried over from the saved project shows no
    chip. A folder passes when any of its remotes points at the repo. A failure keeps the
    previous folder and shows "This folder's git remote doesn't point at <repo>" with "<path>
    points at <other repos>. The folder wasn't added." or "<path> has no GitHub remote. The
    folder wasn't added."
  - A repo with a folder has a **Worktree setup** row under its folder row: "Worktree setup" in
    11 px, weight 500, `fg-2`, then the setup in monospace `fg-3`, such as "2 paths · npm install",
    "1 path", "npm install", or "None", truncated, and updated as you type, and an outline xs
    **Add** ("None") or **Edit**, which reads **Hide** while the fields show. **Hide** only hides
    the fields: what you type is kept, and **Continue** keeps it too. The fields: "Runs only in a
    worktree Sandtable makes, before Claude Code starts." in 11 px `fg-3`, a two-row monospace
    **Copy from the main checkout** textarea (placeholder ".env", one path per line, blank lines
    dropped) with "One path per line. Only files and folders git ignores." in 11 px `fg-2`, a
    monospace **Setup command** field (placeholder "npm install"), and "Kept as you type, and
    saved when you save the project." in 11 px `fg-3`. Save refuses a path git tracks or doesn't ignore
    in the folder, or a folder with a file git doesn't ignore inside it, with "Couldn't save the
    project: Can't copy <path>: git tracks it. Only paths git ignores can be copied." It checks
    only a repo whose copy paths or folder changed, and a repo with no folder reads "Choose a
    folder for <repo> before setting its worktree setup."
  - A repo with no setup whose folder has something to suggest shows the suggestion under the row,
    in the activity strip's inset shell (`surface-2`, `radius` 8 px, 1 px `line` inset ring): a 14 px
    lightbulb in `fg-3`, then "Suggested: copy .env · npm install" in 11 px `fg-2`, the paths and
    command in monospace, truncated, and **Use** as a text link: weight 500, `fg`, underlined in
    `line-2`, `fg-3` on hover. On a saved project, **Use** saves the suggestion to that repo
    right away, apart from the form's other edits, and the row's summary shows it with a check and
    "Saved" in `fg-2`; a refused save shows in the form's problem line. On a project you're still
    adding, **Use** fills the fields and opens them, and they're saved with the project. The suggestion reads only the main checkout: ignored `.env`,
    `.env.*`, and `.claude/settings.local.json` at the repo's top level, and the command a
    lockfile names (`package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `uv.lock`
    uv, `Gemfile.lock` bundle), joined with `&&` across tools, with no Node command when more
    than one Node lockfile is there. **Set up** on a card opens **Edit project** at this step,
    with focus on the repo's **Use**.
- **Review** ("Check the project, then save."): rows for **Name**, **Tickets from** (with the
  board URL), **Columns**, and **Repos** (each repo and its folder, and under a repo with a folder
  "Worktree setup: " and its summary in monospace, in 11 px `fg-3`, truncated, with the summary on
  hover), each with an **Edit** button that jumps to its step. An **Icon** row follows **Name**, with no **Edit**: the tile as the
  sidebar shows it, an outline xs **Choose emoji** button (**Change emoji** once an emoji is set),
  and a ghost xs **Clear** while one is set, which moves focus to the button; without one, an 11 px
  `fg-3` hint reads "Optional. Without one, the tile shows the first letter." The tile is hidden
  from screen readers, so the row reads the chosen emoji out in visually hidden text. The button
  opens a 320 px popover named "Emoji" under its left
  edge, `raised` with `radius-card`, `shadow-lg`, and 8 px padding: a field ("Search emoji")
  that takes focus, then a 232 px scrolling grid of 9 columns of 32 px cells with 20 px emoji under
  sticky 11 px weight-500 `fg-3` category headers on `raised`. The active cell (pointer or arrow
  keys) is `surface-3` with `radius` corners; Enter or a click picks it, which closes the popover
  and returns focus to the button, and Escape closes it. While the emoji load it shows "Loading
  emoji…" with a spinner, and a search with no results shows "No emoji match", announced as a
  status, both in `fg-2`. If the emoji fail to load, an alert reading "Couldn't load emoji." in
  `danger` takes the grid's place instead of the spinner. The grid is named "Emoji". The emoji
  come from the app bundle, not the network, and the grid stops at Emoji 17. While the project
  saves, every control on Review is disabled, so nothing changes after **Save**. Then a **Remote Control** row with no **Edit**: three radio boxes,
  **Use the Settings default** (the default, "The Remote Control switch in Settings decides."),
  **On**, and **Off** ("This project's sessions start with Remote Control on." or "off.").
  Editing shows the saved choice. A **Claude Code account** row follows, also with no **Edit**:
  one radio box per account from Settings, **Default** first and selected unless the project
  saved another, each titled with the account's name over its folder (`~` for the home folder).
  A **Model** row follows, also with no **Edit**: a 160 px select with Account default, Fable, Opus, Sonnet,
  and Haiku, set to Account default unless the project saved a model, beside "The model sessions
  run on. Start and New session can pick another for one session." in 11 px `fg-2`, its
  description.
  An **Editor** row follows, only when an editor's launcher is found or the project saved one: a 160 px select with First
  found and each editor found, beside "The editor a session's side panel opens its folders in." in
  11 px `fg-2`.
  A **Keep done tickets** row follows, also with no **Edit**: a select with 1 day, 3 days, 7 days,
  14 days, and 30 days, set to 7 days unless the project saved another. A **Token cap** row
  follows, also with no **Edit**: a 128 px select with Off, 10M tokens, 25M tokens, 50M tokens,
  100M tokens, and 250M tokens, set to Off unless the project saved a cap, beside "Stops a session
  from running tools once it has used this many tokens, until you raise its cap." in 11 px
  `fg-2`, its description. A **Readiness check** row
  follows, also with no **Edit**: a switch named "Readiness check", on unless the project saved it
  off, beside "At Start, Claude reads the ticket and says what it's missing, such as how you'd tell
  it's done." in 11 px `fg-2`, its description. An **Automatic review** row follows, also with no
  **Edit**: a switch named "Automatic review", off unless the project saved it on, beside "When
  Claude ends its turn with an open pull request, Claude reviews the changes, Sandtable sends the
  High proposals to the session, and the rest wait for you. Up to 3 rounds. You can turn it on or
  off for each session in its side panel." in 11 px `fg-2`, its description. A **Sandbox commands** row follows, also with no
  **Edit**: a switch named "Sandbox commands", off unless the project saved it on, beside a
  description in 11 px `fg-2` that says what a sandboxed command can't do, that SSH remotes, Docker,
  and tmux don't work there, and that routines aren't sandboxed. While it's on, an **Allowed
  domains** monospace input follows, with "pypi.org, *.example.com" as its placeholder and "Added
  to github.com, api.github.com, registry.npmjs.org, and <tracker host>, which sessions always
  reach." in 11 px `fg-2` as its description. An **Instructions** row
  follows, also with no **Edit**: a tab list named "Instructions for", with 24 px pill tabs in
  11 px `fg-2`, **Every ticket** first and then one per label you've added, with the label's color
  dot when its color is known and a long name cut to 160 px with an ellipsis, in full on hover; the selected tab is `fg` at 8% in `fg`, a hovered one `fg` at 5%,
  and the arrow keys move between tabs and select them. A ghost xs **+ Label** follows the tabs.
  Under them, one field shows the selected tab's text, named "Instructions for every ticket" or
  "Instructions for <label>", with the placeholder "Added to every ticket session in this
  project." or "Added when the ticket has <label>." An 11 px `fg-3` line reads "Sessions get this
  after Sandtable's rules. It never goes in the repo."; with a label tab selected, a ghost xs
  **Remove <label>** on its right drops that label, selects **Every ticket**, and moves focus to
  the field. **+ Label**
  opens a 208 px popover with a "Label name" field, where Enter adds, and, when you edit a saved
  project, "Labels on this board" in 11 px `fg-3` over a row per label on its synced tickets
  that you haven't added, by name and without `sandtable: in progress`, with its color dot. Adding a label, by Enter or a click, selects its
  tab and moves focus to the field; a label already there, in any case, is selected instead. A
  new project, or a board that fails to load, shows only the field. Editing shows the saved
  instructions, and blank text isn't saved. With a Linear team, **Tickets from** reads "Linear team" over "<organization> (<slug>)" (or the slug until the workspaces load, and no workspace line when the project has none), "<name> (<KEY>)", and the chosen
  projects, and **Columns** reads "Unstarted issues are To do; started issues are In progress;
  completed issues are Done. Canceled, backlog, triage, and duplicate issues stay hidden." With a
  Jira project, **Tickets from** reads "Jira project <name> (<KEY>) on <site>" over "On board
  <name>" or "No board, so every issue shows", **Columns** adds "Only the board's issues show:
  those in its active sprints, or, on a board without sprints, those outside its backlog." with a
  board, and **Columns**
  reads "Issues in the To Do category are To do; In Progress, In progress; Done, Done." With repo issues, **Columns** reads "Open issues are To do; open
  issues with the label `sandtable: in progress` are In progress; closed issues are Done." and a
  note says "Sandtable creates the `sandtable: in progress` label in a repo the first time it
  needs it there: when a session starts, or when you drag a card to In progress." Editing adds a ghost **Delete project** in `danger` under the rows;
  it asks first in an alert dialog, "Delete <name>?" with "This removes the project from
  Sandtable. Its sessions keep running and its worktrees stay on disk; clean them up in Settings
  under Leftover sessions.", **Cancel**, and a destructive **Delete**.
- The flow fades in over 200 ms with `ease-out-cubic`. Moving forward, the new step enters with
  opacity and an 8 px slide from the right over 200 ms with `ease-out-cubic`; moving back, it
  slides from the left. The old step leaves at once. Rail circles change color over 100 ms
  ease-out. With reduced motion, steps only fade.

## Setup guide

- Every start holds the window on "Checking setup…" with a spinner, centered in `fg-2`, until
  the check finishes, so a failing check never replaces a board you're already using. Then the
  guide fills the panel, with no sidebar beside it, on first run (no projects),
  whenever a check blocks (a missing required tool, or the `gh` login or `repo` scope), and when the check itself fails. A start with only warnings goes straight to the
  app. It reruns every check on **Check again** and stays until you finish it.
- It shares the add-project flow's layout: the header "Set up Sandtable" with "Step N of 6" (or
  "of 5" after first run), the 220 px rail, the content column, the footer, and the motion. The
  steps are **tmux and git**, **Claude Code**, **GitHub CLI**, **Linear CLI**, **Jira CLI**, and on first run
  **First project**. It opens at the first step that blocks, or the first step.
- Rail summaries: "Current step"; "Ready" with a check in the circle; "Ready, 1 warning" or
  "Ready, N warnings"; the first failing check's word in `danger`; "Not checked" in `fg-3` before
  a step is reached ("Not started" for **First project**, which reads "Opens the add-project
  flow" once visited). You can jump to a step you've visited when no step before it blocks.
- Each check step has its heading and lede, then the checks in one borderless `card` fill with
  `radius-card` corners and `line` rules between rows. A row has its label and a status chip,
  12 px icon plus word, never a color alone: **Ready** is `neutral` on `neutral-soft` with
  `Check`; **Missing**, **Not logged in**, and **Missing scope** on a blocking check are
  `danger` on `danger-soft` with `CircleAlert`; a warning (**Not signed in**, **Missing scope**
  for `project`, **Missing** for `linear` or `acli`, **Can't check**) is `amber` on `amber-soft` with `TriangleAlert`; **Not
  checked** is plain `fg-3` text. A failing or warning row adds its fix in `fg-2` and a
  borderless `window` command box, an inset well inside the card with `radius`
  corners, holding the command in monospace and a ghost icon button labeled **Copy**, which turns into
  a check labeled **Copied** for 1.5 s, announced as a status.
- The **Linear CLI** step's rows are **linear installed** (`brew install schpet/tap/linear`)
  and **Signed in** (`linear auth login`), then a **Signed in to <slug>** row for each workspace
  a project uses, with `linear auth login`. All only warn, since only Linear projects need it.
- The **Jira CLI** step's rows are **acli installed**
  (`brew tap atlassian/homebrew-acli && brew install acli`) and **Signed in**
  (`acli jira auth login --web`), then a **Signed in to <site>** row for each Jira site a project
  uses, Ready when `acli jira auth status` shows that site, with
  `acli jira auth switch --site <site>`. All only warn, since only sessions on Jira projects need
  it.
- The **Claude Code** step's rows are **claude installed** and **Signed in**, then a **<name>
  signed in** row for each account other than **Default** that a project uses. Like **Signed
  in**, it only warns: "Sessions for projects that use <name> can't start until it's signed in.
  Sign in in a terminal, then check again. If you use an API key, you can continue.", with
  `CLAUDE_CONFIG_DIR=<folder> claude auth login`.
- The footer holds **Back** (ghost, from step 2 on), a hint ("<word>: run the command, then
  check again" while the step blocks, "You can continue; fix the warning when you need it" with
  one warning or "You can continue; fix the warnings when you need them" with more, "Checking…"
  while checking), **Check again** (outline), and **Continue**, disabled while the step blocks.
  On the last check step after first run it reads **Done** and opens the app; **First project**
  ("Choose where its tickets come from and the local folder of each repo.") has **Back** and
  **Add project**, which opens the add-project flow.
- While **Check again** runs, it reads "Checking…" with a spinner and is disabled, every row of
  the step shows a spinner and "Checking…" in `fg-2` with no fix, and **Continue** stays
  disabled.
- A failed check shows its error in `danger` on `danger-soft` in place of the rows; every other
  step reads "Not checked", and **Check again** stays enabled.

## Terminal

The terminal uses `panel` for its background and the text tokens for text and cursor, 13 px mono, and
follows the scheme the **Appearance** setting picks. Its 16 ANSI colors are the `--ansi-0` to
`--ansi-15` tokens (black, red, green, yellow, blue, magenta, cyan, white, then their bright
forms), each set for both schemes. Black in dark mode is a dim gray, about 2.2:1 on the panel: faint, but visible.

Sandtable's status line shows under Claude Code's prompt in every session's terminal, in Claude
Code's own text, as one line with `│` between its parts: the model and effort, "ctx 46%", "5h 38%
· 7d 61%" once Claude Code reports the limits, Claude Code's price estimate, and "+14 −6" for the
lines added and removed. From 80% for context and 90% for a limit, the figure carries a word, "ctx
84% nearly full" or "5h 92% near limit", so it never depends on color. It replaces your own status
line inside Sandtable's sessions only.
