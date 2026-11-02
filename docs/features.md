# What works today

This list is the authoritative record of what Sandtable does. Every change that adds, changes, or
removes a capability updates it in the same change. Each capability goes under the heading for its
area, as one short bullet. Visual detail, such as colors, sizes, icons, and tooltip text, lives in
`DESIGN.md`. UI text is quoted only where the words identify the capability, such as an error, a
refusal, a notification title, or a format example.

## Projects

- Add, edit, and delete projects in a four-step flow: name, tickets from, repos, and review.
- Tickets come from a GitHub Projects board, the repos' issues, a Linear team, or a Jira Cloud
  project.
- A Linear project uses a team in any workspace you're signed in to, with any of its Linear
  projects. A Linear project with no saved workspace uses the CLI's default one.
- A Jira project goes through an Atlassian account that you add once per site.
- Each repo's folder is picked with the macOS folder dialog and refused unless one of its git
  remotes points at that repo.
- On the review step, a project can get an optional emoji icon from a searchable,
  keyboard-usable grid that works offline.
- A project can hold your own instructions for its ticket sessions, for every ticket and per
  label. When you edit a project, the labels on its board are suggested.
- The arrow keys move between the radio boxes in a group, here and in **New session**.
- Projects are saved in Sandtable's data folder.

### Worktree setup

- Each repo can have a **Worktree setup**: paths to copy from the main checkout into each
  worktree Sandtable makes, such as `.env`, and a setup command, such as `npm install`.
- Saving refuses a path that git tracks or doesn't ignore, so a copy never ends up in a commit.
- A repo with no setup shows a suggestion when its main checkout has one: ignored `.env`,
  `.env.*`, and `.claude/settings.local.json` files, and the lockfile's install command.
- **Use** saves the suggestion to that repo, or fills the fields while you're still adding the
  project.
- The first **Start** from a card in such a repo, each time Sandtable runs, warns on the card that
  new worktrees won't have `.env` or `node_modules`.
- That warning's **Set up** opens the **Repos** step, and **Not now** hides it for that repo for
  good.

## Sidebar and navigation

### Sidebar

- A sidebar of projects, each with its count of sessions in **Needs you**.
- Each project's tile shows its emoji, or without one the first letter of its name. The board
  header shows the emoji too.
- A project's tile shows or hides its sessions. Any project can be open, the selected one opens,
  and Sandtable remembers which are open.
- A collapsed project also counts its sessions in **Running**, **Reviewing**, **Idle**, **Done**,
  and **Done, session open**. Hovering or focusing a count names the sessions it counts.
- An open project lists its sessions without a ticket and its ticket sessions in **Running**,
  **Needs you**, **Reviewing**, or **Idle**, oldest first, then those in **Done, session open**.
- Each row shows its state as a word. A ticket session's row shows the ticket number and title,
  and hovering or focusing it shows the full title and state.
- Clicking a ticket session's row, or pressing Enter on it, opens the ticket on **Conversation**.
- A ticket session leaves the list when it finishes, ends, or its ticket moves off the board.
- A project's **More** menu has **Edit project**, **New session**, **Routines**, **Move to** (No
  group, a group, or **New group…**), **Move up**, and **Move down**.

### Project groups

- Projects can sit in named groups, each its own section after the ungrouped projects under
  **Projects**.
- **New group**, beside **Add project**, adds a group and asks for its name in place.
- A group's heading collapses or expands it, and a collapsed group shows its projects' total
  **Needs you** count.
- A group's **More** menu renames it, moves it up or down, or deletes it, which moves its
  projects back under **Projects**.
- Drag a project between projects, onto a group's heading, or onto **Projects** to take it out of
  its group. Drag a group's heading to reorder the groups.
- Sandtable remembers the groups, the order, and which groups are collapsed.

### Sidebar size and visibility

- **Hide sidebar** in the sidebar header, **View > Hide Sidebar**, or Control+Command+S hides the
  sidebar. **Show sidebar** in the view's header, or the same menu item and shortcut, brings it
  back.
- While the sidebar is hidden, the total **Needs you** count shows beside **Show sidebar**.
- Drag the sidebar's trailing edge to make it between 180 and 400 px wide. With the **Resize
  sidebar** separator focused, Left Arrow and Right Arrow resize it. Double-click the edge to
  reset it.

### Back and forward

- **Go back** and **Go forward** move through the screens you visited, as in a browser: a
  project's board, a ticket, a session, Add project or Edit project, Usage, and Settings.
- Use the buttons in the sidebar header (or the view's header while the sidebar is hidden),
  Command-[ and Command-] (with Option too, as on a Norwegian layout), or the mouse's side buttons.
- A left or right swipe also works, which is what Logi Options+ sends for its Back and Forward
  buttons.
- Switching tabs inside a ticket doesn't add a step, and a view's own **Back** goes back a step
  when it returns to the screen before.
- A step whose project, ticket, or session is gone, or an ended session, is skipped.

## Window

- The window has no title bar. Every view, the setup guide included, sits in a panel inset from
  the window's edges, and you drag the window by the sidebar's top strip and the view's header.
- The window is at least 760 px wide, and every view works down to that width. The sidebar
  narrows to keep the view at least 560 px wide.
- In a narrow view, headers fold actions into a **More actions** menu, show secondary controls as
  icons with tooltips, and count blockers instead of listing them.
- Only one copy of Sandtable runs at a time; opening it again brings the window forward.
- If the window's page crashes, Sandtable reloads it, at most once every 10 seconds. Sessions keep
  running in tmux.
- Sandtable reopens where you left it: the same window size and place on the same display,
  maximized or full screen if it was, and the sidebar shown or hidden at the same width.
- It also reopens the same project, ticket, and **Conversation**, **Details**, or **Changes** tab,
  or session without a ticket. It saves as you go, so a crash or a force quit still restores it.
- A window that no longer overlaps any display opens at the default size, centered on the main
  display. One that only partly overlaps a display is moved and shrunk to fit on it.
- A removed project opens the first project's board, and a removed ticket or session opens its
  project's board.

## Board

### Columns and sync

- A board with **To do**, **In progress**, and **Done** columns.
- With a Projects board, the columns come from the board's Status field. A closed issue shows in
  **Done** even when its Status says otherwise, and a Status mapped to no column, such as Wont
  fix, stays hidden.
- With repo issues, the columns come from issue state and the `sandtable: in progress` label.
  Issues closed as not planned stay hidden.
- With a Linear team, unstarted is **To do**, started is **In progress**, and completed is
  **Done**. Canceled, backlog, triage, and duplicate issues stay hidden.
- With a Jira project, the status category decides: To Do is **To do**, In Progress is **In
  progress**, and Done is **Done**.
- Only tickets from the project's repos show. With no board, all of the project's issues show.
- A Linear project shows the team's issues in the chosen Linear projects, or all of them when
  none are chosen.
- A Jira project shows the issues on its board. On a board that runs sprints, those are the active
  sprint's issues, and none while no sprint is active; on a board without sprints, those outside
  its backlog. **Done** holds the active sprint's done issues within **Keep done tickets**.
- Tickets done longer ago than the project's **Keep done tickets** (7 days unless you change it)
  are hidden, unless their last session still has a worktree.
- Issues with a live or unmerged session, and issues Sandtable changed in the last 2 minutes,
  always show.
- The open project, and every project with a live session, syncs every minute while any part of
  the window shows. Other projects show their last synced board until you open them.
- For a GitHub project, that minute's sync first sends a 1-point check and skips the rest when
  neither the board nor any issue or pull request in its repos was updated since the last sync.
  It runs in full at least every 30 minutes, so a change that updates none of them can show up to
  30 minutes late: a pull request's checks or conflicts, a deleted or transferred issue, or an
  edit to a parent, sub-issue, or blocker in another repo.
- A project also syncs when you switch to it, when the window shows again after being minimized,
  hidden, or fully covered, and with **Sync**.
- Sandtable syncs a project whenever any of its sessions starts needing you.
- The last synced board shows at startup and refreshes on the next sync.
- A failed sync keeps the board and shows the error, which **Dismiss** hides until a different
  error comes. A GitHub call with no answer within 30 seconds fails the sync.
- The header says where the tickets come from.

### Sync limits

- A repo with more than 1,000 open issues, or more than 1,000 closed or updated within **Keep done
  tickets**, shows the 1,000 most recently updated, and the board says so.
- A Projects board with more than 1,000 open issues not in its done Status, 1,000 in it updated
  within **Keep done tickets**, or 1,000 closed ones outside it in that time shows the first 1,000
  of each, and says so.
- A Linear team or Jira project with more than 1,000 open or recently done issues says so.
- A board says when its backlog has more than 1,000 issues, which shows the rest in To do.
- A board says when it no longer exists, and hides nothing until you pick another.
- For a Jira project, each sync reads the merged pull requests of the project's repos, back to the
  **Keep done tickets** window or the start of the oldest session whose merge isn't known yet.
- If a repo can't be read or has more than 500 merged pull requests in that time, the board says
  so. That sync marks the merges it found but doesn't decide that a removed session's ticket never
  merged.

### Cards

- Cards show the issue number (a Linear or Jira issue's key, such as `ENG-12`), repo, parent issue
  on its own line, assignees, title, **Blocked by #n** for each open blocker, and labels.
- A card shows sub-issue progress, "N/M sub-issues", which opens a list of the sub-issues inside
  the card.
- A card shows the board's other single-select fields, such as Priority. A Linear or Jira card
  shows its status name, such as In Review, when it isn't the column's name.
- A card shows the created and updated dates, a state chip with an icon and a word (none on a
  finished card in **Done**), and at most one button for its next step.
- A card in **Done** shows **Merged** when a merged pull request closed its GitHub issue, is
  attached to its Linear issue, or names its Jira key in its branch, title, or body.
- A card in **Done** shows the ticket's token total and, when any model has a price, what that
  use would cost on the API, marked with "\*" when it leaves out a model with no price.
- Clicking a card, or pressing Enter on it, opens the ticket.
- Clicking a card's parent line or a row in its sub-issue list moves to that ticket's card and
  focuses it.
- A ticket whose card is hidden opens its ticket view, and one that isn't on the board opens on
  GitHub, in Linear, or in Jira.

### Pull request stage

- A ticket's open pull request shows its stage on the card, the list row, and the ticket view
  header, from the board sync, and in Gauges for the session's pull request: **Conflicts**,
  **Checks failing**, **Changes requested**, **Ready to merge**, or **PR open**.
- **Conflicts** means the pull request conflicts with its base branch. **Ready to merge** means not
  a draft, checks passing or none, approved or no review needed, and mergeable. A draft always
  shows **PR open**. While GitHub works out mergeability after a push, the stage uses the last known answer.
- A ticket in **Done** shows no stage word, and **Merged** when a merged pull request closed it.
- A Linear or Jira ticket shows no stage word.

### List view

- A **Board** and **List** switcher on the toolbar row under **Sessions**.
- The list shows one ticket per row, with its number, title, labels, state chip (none on a
  finished row in **Done**), and updated date.
- Rows are grouped by status in the board's column order under headers you can collapse.
- Clicking a row, or pressing Enter on it, opens the ticket.
- **New ticket** ends the **To do** group.
- Grouped by assignee, the list shows a collapsible header per person, then that person's rows
  under **To do**, **In progress**, and **Done**. Grouped by parent, it does the same per parent.
- Each project remembers its view and its collapsed groups across restarts.

### Display menu

- A **Display** menu on the toolbar row groups the board and list by **Assignee**, by **Parent**,
  or by **None**.
- It orders each column or list group by **Created**, **Updated**, or **Label**, ascending or
  descending, or keeps the board's own order (**Manual**, or **Default** without a board).
- **Label** uses each ticket's first label alphabetically and puts unlabeled tickets last.
- While grouping or a sort is on, the button names it, such as "Assignee · Updated ↓".
- Each project remembers its grouping and order across restarts.

### Assignee lanes

- Grouped by **Assignee**, the board shows one lane per person with a ticket among the shown
  tickets, sorted by name, then **No assignee**, always last.
- A ticket with several assignees shows in each of their lanes.
- A lane's header collapses it to one line with its ticket count per column. Each project
  remembers its collapsed lanes across restarts.
- Holding a dragged card over a collapsed lane opens it.
- **New ticket** ends **No assignee**'s **To do**.

### Parent lanes

- Grouped by **Parent**, the board shows one lane per parent among the shown tickets, sorted by
  number or key, then **No parent**, always last, which holds every other ticket.
- A lane's header shows the parent's status, number, title, and how many of its sub-issues are
  done, such as "1/3".
- The parent's own card sits in its lane with a **Parent** tag, and the other cards in the lane
  leave out their parent line.
- A ticket that is both a parent and a sub-issue sits in its own lane and keeps its parent line.
- A parent that isn't on the board, because it's closed or outside the filters, still gets a lane,
  with no card of its own.
- On Jira the count covers only an issue's subtasks, so an epic's header, or one that isn't on the
  board, shows none.
- Lanes collapse and are remembered as with assignee lanes.
- A card drags only within its lane, where a drop changes its status. Changing a ticket's parent
  from the board isn't supported.
- **New ticket** ends **No parent**'s **To do**.

### Filters

- A **Filters** menu filters the board by the labels on its tickets: **Show only** shows tickets
  with at least one checked label, and **Hide** hides tickets with any of them.
- In a project with two or more repos, it holds a **Labels** and a **Repos** submenu, each with its
  own **Show only** and **Hide**.
- **Repos** lists the project's repos, plus **No repo** on a Linear or Jira project.
- An **Assignees** menu filters by **Me** (the account signed in to GitHub, to the project's Linear
  workspace, or to its Jira site), **Unassigned**, and each assignee on the board's tickets.
- **Assignees** has the same **Show only** and **Hide** modes as **Filters**.
- A ticket shows only when it passes the label, repo, and assignee filters.
- The board says how many tickets the filters hide. **Clear filter** removes every checked label
  and repo, and **Assignees** has its own **Clear filter**.
- Each project remembers its filters across restarts.
- The filters change only what the board shows: a hidden ticket's session still counts toward
  **Needs you** and still notifies you.

### Drag to change status

- Drag a card to any column, or a row to any list group, to change its status.
- With a Projects board, the drop sets the board's Status to the option mapped to that column. A
  card dragged out of **Done** also reopens its issue if it's closed.
- With repo issues, **To do** reopens the issue if it's closed and removes the
  `sandtable: in progress` label, and **In progress** reopens it if it's closed and adds
  the label.
- With repo issues, **Done** closes the issue as completed and removes the label.
- With a Linear team, the drop sets the team's workflow state of that column's type whose name
  matches the column (Todo, In Progress, or Done, ignoring case), or else the first by position.
- With a Jira project, the drop runs the workflow transition into a status of that column's
  category named like the column (To Do, In Progress, or Done, ignoring case), or else the first
  transition into that category.
- A Jira move with no such transition fails and names the column.
- The card or row moves at once, and a session on it keeps running.

### Drag to change assignee

- Grouped by assignee, a drop in another person's lane also changes the assignee.
- On GitHub, the drop adds the person whose lane the card lands in, then removes the one whose
  lane it left, keeping any other assignees. On Linear and Jira it replaces the assignee.
- A drop on **No assignee** removes the person whose lane the card left, and a drop from **No
  assignee** assigns the lane's person.
- A collapsed lane takes a drop on each column's count, which moves the card to that column, and
  during a pointer drag on the rest of its header, which keeps the card's column.

### Drag with the keyboard, and failed moves

- Space on a focused card or row picks it up, Left and Right Arrow choose a column, Up and Down
  Arrow choose a list group or a lane, Space drops it, and Escape cancels.
- Up and Down Arrow don't change the lane while grouped by parent.
- Releasing the pointer outside every column or group cancels the drag.
- A failed move puts the card or row back and shows "Couldn't move #<number>: <reason>" in the
  board's error line, with the key in place of `#<number>` for a Linear or Jira issue.
- A failed move keeps whatever it already wrote: when the status write succeeded and the assignee
  write failed, only the assignee goes back.
- When GitHub added the new person but couldn't remove the old one, Sandtable syncs and the card
  shows in both lanes.

### New ticket

- **New ticket**, at the end of the **To do** column or group, turns into a composer card where
  you type a title and description and, with more than one repo, pick the repo.
- On a Linear project, you pick the Linear project instead when there's more than one, and the
  issue goes to the team's Todo state.
- On a Jira project, the issue is a Task, or the project's first issue type that isn't a subtask,
  and starts in the workflow's first status.
- On a Jira board that runs sprints, Sandtable adds the issue to the active sprint. When there is
  no single active sprint, it says the issue was created in the backlog.
- On a Jira board without sprints, the issue stays where Jira puts it.
- **Create**, or Enter in the title, creates the issue, adds it to the board in the to-do Status on
  a board project, syncs, names the issue it created, and clears the composer for another.
- Escape cancels and returns focus to **New ticket**.
- What you typed and didn't send stays, per project for **New ticket** and per parent for **Add
  sub-issue**, until you create, draft, or cancel. Quitting Sandtable clears it.
- **Draft with Claude** starts a session without a ticket, named "New ticket", in the repo's main
  checkout, seeded with what you typed.
- That session drafts the issue with you, follows the repo's `CLAUDE.md` issue format, and files it
  with `gh issue create` only after you approve.
- On a Linear project it runs in the first repo and files with `linear issue create` in the team.
  On a Jira project it runs in the first repo and files with `acli jira workitem create`.
- A failure after the issue exists names it, makes the fields read-only, and offers only
  **Close**, so you don't create it twice.

## Starting a session

### Checks before a start

- **Start** on a card or in the ticket view first checks for open blockers and shows them with
  **Start anyway** and **Cancel**.
- **Start** refuses a done ticket, and a ticket that already has a live session in any project
  over the same GitHub, Linear workspace, or Jira site, naming that project.
- **Start** refuses a ticket whose tmux session name another live session already uses.
- A Linear project with no saved workspace matches any workspace in that check, since it uses the
  CLI's default one.
- **Start** checks that each repo folder it uses still points at its GitHub repo.
- If a folder is gone or no longer points at its repo, the card and the ticket view show **Can't
  start** and **Choose folder…**.
- A folder that passes the check is saved to the project and clears **Can't start** on every
  ticket from that repo.

### Triage

- On a ticket without an `area:` label, **Start** first asks Claude, which reads the repo but can't
  change it, for the area and blockers.
- Triage shows its result with **Apply**, **Start anyway**, and **Cancel**, and writes nothing to
  the tracker until you select **Apply**.
- The first triage on a repo or Linear team with no `area:` labels proposes a set,
  and **Apply** creates them, finishing the set when an earlier **Apply** created only part of it.
- On a Linear issue, Claude picks from the team's `area:` labels, and **Apply** creates new ones as
  team labels and adds the blockers as Linear **Blocks** relations.
- On a Jira issue, Claude picks from the `area:` labels on the project's issues, and a new area's
  name can't contain spaces, such as `area:sessions`.
- On Jira, **Apply** adds the label and links each blocker with the site's link type whose
  outward description is "blocks", set on the blocked issue so the blocker shows as "is blocked
  by".
- The blocker check reads the same Linear relations and Jira links that **Apply** writes.
- **Apply** writes the blockers before the label and skips blockers the ticket already lists, so an
  **Apply** that failed partway can be applied again.

### Readiness check

- Next, unless the project's **Readiness check** is off on its **Review** step, Claude reads the
  ticket's title, text, and comments, read-only with the project's account.
- Claude says whether the ticket states what to change, why, and how you'd tell it's done, judged
  by the issue format in the repo's `CLAUDE.md` when there is one.
- A ready ticket goes on with only a progress note on the card or under the ticket view's header.
- A ticket that isn't ready shows **Not ready** with what's missing, **Refine in chat**, **Start
  with planning**, **Start anyway**, and **Cancel**.
- **Refine in chat** opens the ticket's chat with the gaps as your message.
- A ticket whose title and text haven't changed since it passed skips the check until Sandtable
  quits.
- A failure or a 3-minute timeout shows the error with **Start anyway**.

### Overlap check

- When tickets in the same repo (or Linear team or Jira project) with the same `area:` label are
  **In progress**, or have a live or starting session whose ticket isn't done, Sandtable asks
  Claude whether they really overlap.
- The overlap check is read-only and runs with the project's account. The card or the strip under
  the ticket view's header names the tickets it checks.
- If none overlap, the session starts. Otherwise the check shows **Overlaps** with Claude's reason
  for each one, and **Start anyway** and **Cancel**.
- If the check fails or takes over 3 minutes, it shows the error and the tickets that share the
  area label.
- A missing repo folder skips the overlap check and goes straight to the start, so the card shows
  **Can't start** and **Choose folder…**.
- The overlap check keeps running when you open the ticket or go back to the board, and both show
  it. **Cancel** while it waits drops its result.

### Start with note

- **Start with…**, after **Start** and the model chip on a card and in the ticket view, opens a
  menu with **Start with note** and **Start with planning**.
- **Start with note** opens a composer in place for a note to this session.
- Its **Start**, or ⌘↩, runs the same checks as **Start** and puts the note, cut to 4,000 bytes,
  at the start of Claude's first message, before the issue. Escape closes it.
- Cancelling a check or a failed start keeps the note for next time; a start that succeeds clears
  it.
- The note isn't saved, so **Resume** doesn't send it again.

### Start with planning

- **Start with planning**, in the **Start with…** menu and on a **Not ready** ticket, runs the same
  checks as **Start**, then starts Claude Code in plan mode.
- In plan mode Claude can't edit until you approve its plan on the plan card, and your choice there
  sets the mode afterward.
- Cancelling a check drops the choice, so the next **Start** doesn't plan. **Resume** doesn't plan
  again.

### Branch, worktree, and repo

- Sandtable makes a branch, or reuses the one from the ticket's last session, and a worktree of
  the ticket's own repo in `<repo>-wt.noindex/`, a folder Spotlight doesn't index.
- A Linear or Jira issue's branch is named from its key, such as `app-12-fix-the-login`.
- A Linear or Jira issue's repo is the project's only repo, the repo a `repo:<name>` label names,
  or the main repo of the issue's last session. Otherwise the Start dialog asks which repo.
- Any number of the project's other repos can join the session, pre-checked with the extra repos
  of the ticket's last session.
- Each extra repo gets a worktree on the same branch and is added with `--add-dir`, and
  **Resume** reopens them all.
- Before it makes a branch, Sandtable fetches the repo's default branch from GitHub, so the branch
  starts from the latest code.
- If the fetch fails, for example when you're offline, the branch starts from your local copy, and
  the card and the ticket view say why while the session runs.
- If the repo has no `origin/HEAD` that `git remote set-head origin --auto` can recover, the
  branch starts from the checked-out branch, and the warning names that branch.
- A branch that already exists is reused as it is, without a fetch.
- If another ticket's session uses the branch's worktree, Start refuses with "Another ticket's
  session uses <branch>".

### Worktree setup run

- When a repo has a worktree setup, a worktree this Start made, or one whose setup didn't finish,
  gets it before `claude` starts.
- The setup copies the paths, then runs the setup command in your login shell for at most 10
  minutes, with progress and the command's latest output on the card and in the ticket view.
- A path missing from the main checkout is skipped with a note.
- If the command fails, the block shows its last lines and offers **Start anyway**, which starts
  `claude` without it, and **Cancel**.
- After a failed setup the worktree stays, and the next **Start** runs the setup again.
- A reused worktree, **Resume**, and **Main checkout** sessions skip setup.

### Claude Code start

- Sandtable opens `claude` in a tmux session with the ticket as the first message.
- Claude gets the issue text without the parts the ticket view hides, such as raw HTML.
- The text sent to Claude drops control, format, and default-ignorable characters, typed or
  written as character references, apart from line breaks and tabs.
- It also drops numeric references to surrogates or to numbers past Unicode's range.
- Sandtable sets the ticket to In Progress if it isn't already, and skips that when the ticket
  became done during setup.
- For a Linear issue, In Progress is the team's started state named In Progress, or else its first
  started state by position. For a Jira issue, it's the transition into the In Progress category.
- If starting fails for another reason, Sandtable removes any clean worktree that this Start made.
- Any other failure shows as "Couldn't start: <reason>" on the card and in the ticket view, even
  when the card that clicked **Start** is gone by then.
- If `claude` exits within 10 seconds of starting or resuming, the card, the ticket view, and the
  session view say so next to **Finished** and suggest running `claude` in the session's folder.

## Ticket view

- A ticket view with a **Details** tab, plus **Conversation** once the ticket has a session and
  **Changes** once that session has a worktree. ⌘\ moves to the next tab.
- **Conversation** keeps running behind the other tabs, and its tab shows **Needs you** when the
  session needs you, unless the ticket is in **Done**.
- The header shows **Blocked by #n** for each open blocker, or a count of blockers in a narrow
  view.
- When the ticket has a session, the header shows only its state and the buttons that need you,
  **Clear Needs you** and **Raise cap**. The rest of the session lives in the side panel.
- The pull request chip beside the title is the ticket's own, from the board.
- On a tab without the side panel, or in a view under 900 px wide, a **Context** button in the
  header opens the panel. The session view's header works the same way.
- A ticket in **Done** that a merged pull request closed, a Linear issue with one attached, or a
  Jira issue that one names, shows **Merged** in the header. Clicking it opens
  the most recently merged one on GitHub without opening the ticket.
- On a ticket in **Done** whose session finished, **Remove worktree** comes before **Resume**.
- When any of the project's instructions apply to the ticket, the ticket view lists them under its
  header, with **Show** for their text.

### Details

- **Details** opens with the title, and under it **Start** for a ticket with no session (or
  **Resume** and the other session actions) and **Open on GitHub**.
- **Details** shows the issue text as GitHub-flavored Markdown; raw HTML isn't rendered and images
  don't load. A Jira issue's text and comments show as Jira's wiki markup, unconverted.
- **Details** shows comments oldest first, labels, and linked pull requests with their state as a
  word: **Open**, **Merged**, or **Closed**.
- A Linear issue's pull requests are the ones Linear's GitHub integration links to it; a Jira
  issue's are the merged pull requests the last sync found naming its key.
- **Open on GitHub** (**Open in Linear** or **Open in Jira**) and links in the text open in the
  browser.
- **Details** loads again when a sync changes the ticket's labels or blockers.

### Sub-issues

- A parent's **Details** lists its sub-issues (Jira sub-tasks) above the description, with "N/M
  done", a progress bar, and a row per sub-issue with its status as a word and its assignee.
- A sub-issue's **Details** names its parent at the top and under **Parent** in the aside.
- A sub-issue in another repo shows its repo before the number.
- A sub-issue or parent on the board opens its ticket view; one that isn't opens on GitHub,
  Linear, or Jira.
- Jira sub-tasks, and GitHub sub-issues that aren't on the board, show no assignee.
- GitHub lists a parent's first 50 sub-issues, "N/M done" counts all of them, and a last row links
  to the rest on GitHub.
- On a GitHub or Linear project, **Add sub-issue** opens the **New ticket** composer under the
  list, or alone above the description on a ticket with none.
- **Add sub-issue** files the issue with its parent set: on GitHub in the parent's repo, and in
  the to-do Status on a board project, and on Linear in the Linear project you pick.
- **Add sub-issue** isn't offered on Jira, or on a GitHub ticket whose repo isn't in the project.

### Ticket usage

- **Usage** in the ticket view shows the ticket's tokens from its sessions, chat, session
  summaries, reviews, triage, and readiness and overlap checks.
- It shows the total, its share by token type, each model's tokens and API price, and the summed
  API price estimate, which isn't what you paid.
- Under the total, Sandtable shows how long Claude ran turns in the ticket's sessions.
- That time leaves out time a session waits on you, turns you stop with Esc, and the chat,
  summaries, reviews, triage, and checks.

### Ticket chat

- A chat panel beside **Details** lets you ask Claude about the ticket, with or without a session.
- **Hide chat** folds the panel to a narrow rail and **Show chat** brings it back. It starts hidden
  in a window under 900 px wide.
- With no chat yet, three suggestions each send their question.
- Each message runs `claude -p` in the ticket's repo, or the project's first repo for a Linear or
  Jira issue whose repo isn't known yet, as the project's Claude Code account.
- The chat uses read-only tools (Read, Grep, and Glob), with reads of `.git` and credential files
  such as `.env`, `.npmrc`, and `*.pem` denied, and a 3-minute timeout.
- The first message gives Claude the ticket's title, text, and comments, and later ones continue
  the same conversation.
- While Claude answers, drafts, or rewrites, Claude's latest step shows beside the status.
- **Stop** in place of **Send** ends the run and leaves your text where it was to edit and send
  again. Claude Code keeps a stopped follow-up message, so the next answer can still see it.
- A chat keeps the account and repo folder it started with.
- The chat follows its end as it grows, as the conversation does.
- Each ticket keeps one chat and its draft, saved across restarts; **Start over** asks first, then
  deletes them.
- The panel keeps its unsent text per ticket across screens and restarts.

### Comments

- A switch above the message box, **Ask Claude** or **Comment**, swaps it for the comment draft,
  so the panel holds one box at a time.
- You can write the draft yourself, even with no chat.
- **Draft with Claude** asks Claude to sum up the chat, and **Rewrite with Claude** rewrites your
  text using the ticket and the chat. Either one replaces the text.
- **Post comment** adds the draft to the issue, on GitHub, in Linear, or in Jira, after which
  **Details** loads again and shows it. Nothing posts without that click.

### Session summary

- When a ticket's session finishes while Sandtable is open, because Claude Code exits or you end
  it, Sandtable asks Claude to draft a summary comment from the session's conversation.
- The summary covers what changed, the decisions and why, what was left out, and the pull request.
- It lands in the comment draft, labeled **Session summary**, and you edit it and click **Post
  comment**, or **Discard**.
- The panel switches to **Comment** unless you're typing a message, a draft is already open, or
  Claude is answering in the chat.
- **Summarize session**, in the **Conversation** tab, drafts one for the session you picked,
  finished or not, and replaces the open draft.
- The summary runs in the ticket's repo with no tools, as the project's Claude Code account, with a
  3-minute timeout, and counts toward **Usage**.
- Sandtable sends the conversation with common token shapes and private keys replaced by
  "[redacted]".
- A failed summary shows its error in the chat panel and leaves the draft as it was.
- Turning Remote Control off restarts the session without a summary. A session without a ticket
  gets no summary.

### Sessions in other projects

- While a project over the same GitHub, Linear workspace, or Jira site has a live session on a
  ticket, the ticket's card, list row, and **Details** in every other project show that session.
- They show the session with its project and state, as **Done, session open** while the ticket is
  in **Done** there.
- The card and **Details** show it as a row with **Open**, which opens the ticket's
  **Conversation** in that project, in place of **Start** and **Resume**.
- A finished session's **Conversation** shows the same row.

## Conversation

### Conversation tab

- The **Conversation** tab shows the Claude Code conversation of the ticket's latest session, even
  after the worktree is removed.
- It follows a live session as Claude writes it, within about a second: your messages, including
  those you type while Claude is working, and Claude's as Markdown.
- Each code block and table in Claude's replies has **Copy**, which copies the code without its
  fence, or the table as its Markdown rows.
- Each run of tool calls is one row that opens to a row per call with its name and what it acted
  on, which opens to show its input and output.
- Links in tool input and output open in the browser.
- A slash command you ran, such as `/context`, shows as a card with what it printed. A skill shows
  the card alone, and `/clear` and `/compact` don't get one.
- A compaction shows as a line with its time. Auto-compaction summaries don't show.
- A long conversation shows its last 500 entries.
- After `/clear`, the conversations before and after it show as one list with a "/clear" message
  from you between them.
- While Claude works, the last line shows Claude's latest step, with the time since your prompt and
  **Stop**.
- **Stop** presses Esc in the session to interrupt the turn and sets the session to **Needs you**.
- The conversation stays at its end as it grows until you scroll up; then **Scroll to end** brings
  you back, and the conversation follows again.
- The tab says so when the conversation isn't written yet or Claude Code's history was cleared.
- When a ticket has more than one session, a **Session** picker lists them newest first with their
  start time and state. You can read any of them; the buttons show only under the latest.
- A finished session shows the ticket's buttons where the composer was.
- Sandtable reads each session's conversation from the folder of the Claude Code account the
  session started with: for Default, `CLAUDE_CONFIG_DIR` when Sandtable starts with it set, and
  `~/.claude` otherwise.

### Find and message list

- **Find in conversation** (⌘F, while the tab shows) highlights every match in the text of
  messages and tool rows, case-insensitive, and leaves out Sandtable's own labels.
- Find counts matches up to 1,000 and steps through them with Enter and Shift+Enter, opening a
  folded tool row when the match is inside it.
- **Your messages** lists the messages you sent, by their first line, with a filter; picking one
  scrolls the conversation to it.
- Both sit at the top of the conversation, in the session view too.

### Composer

- A composer under the conversation sends your message to the live session, as if you typed it and
  pressed Enter. Shift+Enter adds a line.
- Typing `/` opens a palette of the session's slash commands: built-ins, skills, plugins, and your
  and the repo's commands, filtered as you type.
- The palette shows the picked command's argument hint, description, and source. Up and Down move,
  Enter or Tab fills in the command, and Esc closes it.
- Sandtable reads the commands from Claude Code once per session, and again after a failed read.
  Commands that only open a panel in the terminal, such as `/model` or `/usage`, aren't listed.
- While the session is idle and the composer is empty, Claude Code's suggested next message shows
  as the placeholder, and Tab or Right fills it in.
- Sandtable reads the suggestion from the terminal every 3 s while you look at the conversation,
  and never types it for you.
- A message you send waits in a tray over the composer, marked **Queued** while Claude works, until
  the conversation shows it.
- A failed send stays in the tray with its error, **Send again**, and **Remove**.
- Text and images you haven't sent stay in the session's composer across screens and restarts,
  until you send or delete them.
- Sandtable saves unsent drafts in its data folder, under `drafts/`, and deletes a session's draft
  with its worktree.

### Images

- To send an image, paste it or drop it on the composer. PNG, JPEG, GIF, and WebP images up to 10
  MB each show as chips with the file's name and size, each with **Remove**.
- Another file type, or a larger image, is refused with a message that says why.
- You can send images with no text.
- Sandtable saves each image in its data folder, under `images/<session>/`, and sends its path as
  a quoted `@` mention before your text, which Claude Code attaches or Claude reads with its Read
  tool.
- The session's `--settings` file allows Read in that folder, so Claude doesn't ask.
- Your message shows a thumbnail of each image you sent, and clicking one shows it larger.
- The images are deleted when the session's worktree is removed, and their thumbnails then read
  "Deleted".

### Question card

- When Claude asks you something, a question card ends the conversation and you answer there.
- An `AskUserQuestion` card shows each option's description, the focused option's preview, a note
  on it, **Other**, multi-select, a review step, and **Chat about this**.
- A permission prompt card shows the tool, its input, and the choices the terminal shows.
- A plan card shows the plan with its approve and **Tell Claude what to change** choices.
- A subagent's permission prompt names the subagent. When several subagents ask at once, the card
  shows each request in the order the terminal does.
- Sandtable reads the questions and the plan from the transcript, a subagent's request from the
  `PermissionRequest` hook, and the choices from the terminal's screen.
- Clicking a choice types the same keys you would in the terminal, after checking the terminal
  still shows the prompt untouched. If you started answering there, the card says to finish there.
- Picking **No** on the main session's permission stops Claude, and the composer then takes what to
  do instead. On a subagent's, it declines only that subagent's tool call.
- **Open in terminal** on the card opens the terminal drawer.
- While Claude asks, the composer is disabled, with a note to answer on the card or in the
  terminal first.

### Terminal drawer

- A terminal drawer holds the live terminal. **Terminal** on the composer opens it, screen readers
  hear it as pressed while it's open, and **Hide**
  closes it at any time.
- When Claude asks something the card can't show, such as an MCP server's request for input, the
  drawer opens and takes the focus.
- The drawer closes when the next hook event shows the question answered, unless you opened it
  yourself.
- If you were typing in the composer when the drawer opened, **Hide** takes the focus instead of
  the terminal, so your keystrokes can't answer the prompt.

### View switch

- A **View** switch at the top of the side panel chooses **Conversation** or **Terminal**, read by
  screen readers as a radio group.
- **Terminal** shows Claude Code's live terminal in place of the conversation and the composer,
  sized to that area so the tmux session follows the window, and gives it the keyboard focus.
- Since the terminal keeps Tab for Claude Code, F6 moves the focus out of it, to the side panel,
  and Shift+F6 back before it.
- The drawer, question card, working line, message tray, **Find in conversation**, and **Your
  messages** show only in **Conversation**.
- Once the session ends, **Terminal** says so and shows the buttons the **Conversation** view shows
  where the composer was.
- The choice holds for every session, switches every open conversation at once, and is remembered
  after a restart. It starts as **Conversation**.

### Side panel

- A side panel beside the conversation, named **Session** for screen readers, shows how full the
  context window is and, on a subscription, how much of the 5-hour and 7-day limits is used and
  when each resets.
- Each meter warns from 80% context or from 90% of a limit.
- From 80% context on a live session, **Prepare to compact** asks Claude to write what it needs to
  carry on to `notes/<session>.md` in Sandtable's data folder.
- **Compact** then types `/compact` keeping that file. Both wait until Claude stops working and
  you've answered it, and stay disabled after a click until the conversation moves on.
- The session's `--settings` file allows Read and Edit of that one notes file, so Claude doesn't
  ask, and the file is deleted when the worktree is removed.
- Folded rows show this session's tokens, API price estimate, elapsed time, API time, and
  compactions, and the model, effort, and permission mode.
- A **Where** row shows the worktree, removed worktree, or main checkout, its branch, repos, and
  folders, and **Sandboxed** while it isn't removed.
- A work row shows files changed with lines added and removed, the pull request and its stage, and
  review findings. The files and findings open **Changes**.
- Rows also show subagents and background shells still running, and Claude's to-do list.
- A finished session's panel leaves out the limits, permission mode, and running agents.
- In a view under 900 px wide, and on the **Details** and **Changes** tabs, the panel folds into a
  **Context** button with the **View** and **Remote Control** switches, and on a ticket session
  **Automatic review**.
- On **Details** and **Changes**, the panel leaves out the **View** switch.
- The numbers come from a status line Sandtable passes through `claude --settings`, which also
  shows them in the terminal under Claude Code's prompt, with a word next to a figure near its
  limit.
- The status line replaces your own in Sandtable's sessions only, and you don't set anything up.

## Changes and review

### Changes tab

- **Changes** shows the diff of the session's worktree against its merge base with the default
  branch, the same base the pull request uses.
- The diff covers commits on the branch, uncommitted edits, and untracked files that `.gitignore`
  doesn't skip.
- The tab shows how many files changed, from any tab, once there are any.
- A list of changed files, each with its change as a word (**Added**, **Modified**, **Deleted**, or
  **Renamed**) and its added and removed line counts, sits beside the selected file's diff.
- Each diff line is marked `+` or `−`, and Up and Down move between files.
- A session with extra repos lists each repo's files under its own heading.
- A binary file shows no lines. Which files count as binary follows the default branch's
  `.gitattributes`, not the branch's own.
- A file with more than 1,000 diff lines shows only its counts, and so does every file after the
  first 300. A line over 2,000 characters is cut off.
- Characters that reverse the text direction show as `<U+202E>` and the like.
- A repo Sandtable can't read shows its error without hiding the others.
- **Refresh** reads the diff again, and so does a session going from **Running** to **Needs you**,
  **Reviewing**, or **Idle**.
- **Changes** never stages, commits, merges, or discards anything.
- After **Remove worktree**, the tab says the worktree was removed.

### Findings

- A **Findings** rail beside the diff holds what you want the session to fix, saved per session
  across restarts.
- Click **+** beside an added or unchanged line to comment on it, or Shift-click a second line for
  a range. A removed line takes no comment.
- A finding follows its first line's text when the lines move, and shows **Outdated** when that
  text is gone.
- A finding's source reads **You**, **Claude review**, **PR check**, or **PR comment**.
- **Send to session** pastes the checked findings into the terminal as one message and marks them
  **Sent**. **Send all** does the same for every unsent finding, checked or not.
- **Select all** checks every unsent finding, or clears them when all are checked.
- The rail switches between **To send** and **Sent**. A sent finding moves to **Sent**, shows on one
  line, opens to show its text and **Delete**, and is never sent again.
- While Claude is working, Claude Code queues the message for when it can take it.
- Send refuses while Claude asks you something such as a permission, while the session starts, and
  once it has finished.
- Sandtable learns that Claude is asking from a hook event, so a prompt that opens the moment you
  click can still take the paste and its Enter.

### Claude review

- **Claude review** runs `claude -p` in the session's worktree as the project's Claude Code
  account, with read-only tools (Read, Grep, and Glob) and a 10-minute timeout.
- The review can't read, search, or list `.git` or credential files such as `.env`, `.npmrc`, and
  `*.pem` in any worktree.
- The diff it gets leaves out those credential files and files that show only their counts. A diff
  over 200,000 bytes is cut to fit, and Claude is told so.
- The review also reads the ticket and the note you started it with. Work that neither asked for
  comes back as a finding of at most **Medium**.
- When the ticket has a **Done when** or acceptance section, each criterion the changes miss comes
  back as a proposal named by that criterion, quoted from the ticket. A criterion the ticket doesn't
  contain is dropped. A ticket missing from the sync gets a review of the diff alone.
- Up to 20 findings, each with a severity of **High**, **Medium**, or **Low**, show as **Review
  proposals** until you **Keep** or **Discard** each, or **Keep all**.
- A new review replaces the proposals you haven't decided on.
- The rail says when Claude last reviewed and how many reviews ran, and from the second review on,
  marks what the latest review proposed as **New**.
- The review counts toward **Usage**.
- Nothing posts to GitHub: an AI review never becomes a pull request review.

### Pull request findings

- The rail's **Pull request** section shows each open pull request from the session's branch with
  its checks (**Passing**, **Failing**, or **Pending**), its review decision, and its unresolved
  review threads.
- **Add** on a failing GitHub Actions check makes a finding with the last 200 lines, at most 50 KB,
  of its failed log. **Add** on a thread makes one from its comment.
- Each added check or thread then reads **Added**.

### Automatic review

- **Automatic review** is set per project on the **Review** step, off by default, and per ticket
  session with the side panel's switch, which starts from the project's setting.
- With it on, when Claude ends its turn while its branch has an open pull request and its diff
  differs from the last one reviewed, Sandtable runs **Claude review** on its own.
- The automatic run uses the same tools, deny rules, and timeout as **Claude review**.
- It keeps the **High** proposals on lines of the diff and sends them to the session as one
  message, which then shows them **Sent**. **Done when** proposals always wait for you.
- That message tells Claude to check each finding against the code and not to run commands it
  names, and fences each review's text.
- **Medium** and **Low** proposals wait as **Review proposals**, along with undecided ones from
  earlier rounds.
- A new proposal on the same lines, or for the same **Done when** criterion, as an earlier undecided
  one replaces it.
- The next round starts when Claude ends a later turn with changed work. The rounds stop after a
  review with no **High** proposals or after 3 rounds.
- The rail says where the loop stands or why it stopped.

### When automatic review runs and sends

- Sandtable doesn't start a round while Claude asks you something, while the session starts, or
  while it's capped.
- When the composer holds a draft or a review you started is running, Sandtable skips that turn
  end and tries again the next time Claude ends its turn.
- It sends only while the session still needs you and isn't capped, with no draft in the composer
  and no text typed at the terminal prompt. Otherwise the **High** findings stay kept and unsent.
- Turning the session's switch off, or the project's setting for a session that follows it, stops
  the rounds, even one under way, and the pull request findings for that session.
- Only turning the session's switch on again starts stopped rounds over; turning the project's
  setting off and on again doesn't.
- A round turned off and on again during its review says so.

### Automatic pull request findings

- After each board sync, on any tracker, Sandtable adds each failing GitHub Actions check and
  unresolved review thread on a live session's open pull request as an unchecked finding.
- Each is added once, so a finding you delete isn't added again, and a finding you added yourself
  stays as it is.
- These findings wait for you to check and send them, or to send them with **Send all**.

### Automatic review states and notifications

- While a round runs, the session shows **Reviewing** in place of **Needs you**.
- A "Reviewing" notification opens the ticket's **Changes** tab when you click it.
- A notification titled "Review: <ticket>" says how many proposals wait. It counts every undecided
  proposal and every unsent **High** finding, and clicking it opens the **Changes** tab.
- **Notify when a session needs you** turned off in **Settings** turns off both review
  notifications.
- A round that starts after you've sent Claude a message, or while Claude asks you something,
  shows no **Reviewing** and sends no "Reviewing" notification.
- The turn's **Needs you** notification waits while a round may start, and comes only when no round
  starts, or the round sends nothing and leaves nothing waiting.
- A capped session's notification doesn't wait.
- When Claude asks you something during a round, the session shows **Needs you** and notifies right
  away. A `Stop` or idle prompt during a round keeps **Reviewing**.
- When the round ends, the session goes back to **Needs you**, or to **Running** once the sent
  **High** proposals start Claude working.
- A ticket in **Done, session open** gets neither the "Reviewing" nor the proposals notification.

### Automatic review in the conversation

- Under the side panel's **Automatic review** switch, a callout shows the round, how many files
  changed, and when it started, with **Open Changes**, while the session shows **Reviewing**.
- The callout goes away when the round ends, when you send a message during the round, or when
  Claude asks you something.
- The conversation shows each round as a block where Claude's turn ended, with its round number and
  start time, progress while it runs, and then how it went.
- The outcome says what was sent to Claude and what waits for you, that nothing was found, or why
  the round ended early.
- An error is cut to one line of at most 300 characters, with anything that looks like a token
  replaced by "[redacted]".
- **Open Changes** opens the **Changes** tab and keeps keyboard focus on it. Screen readers hear
  when the newest round starts and how it ends.
- The session keeps its latest 20 rounds. The block is Sandtable's note: Claude never sees it.
- A round that's still running when Sandtable quits says so.
- A review you start with **Claude review** shows none of these.

## Sessions

### Sessions without a ticket

- **New session**, at the end of the board's **Sessions** strip, under each open project in the
  sidebar, and in a project's **More** menu, starts a Claude Code session without a ticket.
- Its dialog asks for the repo when the project has more than one, and where the session runs:
  **Main checkout** (the default), whose files it can change, or **New worktree**, with its own
  `session-` branch.
- You can write its first message, or leave it empty and type it in the terminal. A session
  started without one shows **Idle** until you send it.
- **Save as routine** turns the dialog's choices into a new routine instead.
- **New session** runs the same folder check as **Start** and changes nothing on GitHub.
- A **New worktree** session runs the repo's worktree setup the same way, in the dialog.
- If the start fails, the dialog shows why and removes the worktree it made if it's clean.
- After a failed setup the dialog keeps the worktree for **Start anyway** until you click
  **Cancel** or close the dialog.
- Each session is named by its start time, such as "Oct 25, 14:32", or for a routine's run after
  the routine, until you rename it.
- Sessions are listed under their project in the sidebar and in the **Sessions** strip above the
  board's columns, which always shows, with its count, even with no sessions.
- A session without a ticket has the same **Running**, **Needs you**, **Idle**, and **Finished**
  states, **Needs you** count, and notification as a
  ticket's session, and a routine's run can also be **Done**.
- Its session view has the same live conversation, composer, terminal drawer, and side panel as a
  ticket's **Conversation** tab, with no tabs.
- The view has **End session**, plus **End session and remove worktree** for a worktree, in a
  **More actions** menu when the view is narrow.
- A finished one offers **Resume** where the composer was, and **Remove from list** (main
  checkout) or **Remove worktree** (worktree).
- Each card in the **Sessions** strip also has an X that asks and then does the same cleanup
  without opening the session view.
- A worktree with uncommitted or unpushed changes is kept, and the card shows why.

### Session states

- Session states **Running**, **Needs you**, **Idle**, **Done** (routine sessions only), and
  **Finished** are driven by Claude Code hooks passed through `claude --settings`, never through a
  repo's own settings.
- **Reviewing** is driven by automatic review while one of its rounds runs.
- A session returns to **Running** when you send a message or one of the main agent's tools
  finishes, such as after you approve a permission prompt. A subagent's tool finishing leaves the
  state as it is.
- A session stays **Running** while Claude Code's background work runs.
- A background command that keeps running, such as a dev server, shows **Needs you** (**Done** for a
  routine's session) after about a minute.
- Sessions live in tmux, so they survive closing Sandtable; on start Sandtable reconnects to them.

### Activity

- Sandtable reads what a **Running** session is doing from its Claude Code conversation file every
  3 s: its latest step, such as "Running `npm test`", the kind of step, and how long the turn has
  run.
- A board card and a **Sessions** strip card show the step as a strip that, once there's an earlier
  step, opens the last five steps in place.
- A list row and the side panel show it as a pill whose tooltip lists the last steps, and an open
  conversation shows the latest step at its end.
- The state word stays beside the step. **Needs you**, **Reviewing**, **Idle**, **Done**, and
  finished sessions show no step.

### Clear Needs you

- **Clear Needs you**, on a **Needs you** card, in the ticket and session view headers, and on a
  sidebar session row, moves the session to **Idle** without ending it.
- An **Idle** session doesn't count toward the sidebar's **Needs you** and sends no notification.
- A session stays **Idle** across restarts until Claude stops again, asks you something, or is
  resumed, which brings back **Needs you** and its notification, or **Done** for a routine's
  session that isn't asking.

### Done, session open

- A ticket in **Done** whose session is still open shows **Done, session open** in place of
  **Running**, **Needs you**, **Reviewing**, or **Idle**.
- It doesn't count toward the sidebar's **Needs you** and sends no notification. The sidebar lists
  it after its project's live sessions.
- **End session and remove worktree**, on the card and in the ticket view, ends the tmux session
  and then removes the worktree. If the removal refuses, the session stays ended and the reason
  shows.
- Nothing ends a session or removes a worktree on its own.

### Resume

- **Resume**, on the card, in the ticket view, or in the session view, restarts a finished session
  with `claude --resume`, in the latest conversation a `/clear` started.
- The resumed session shows **Needs you** (**Done** for a routine's session), without a
  notification, until you send a message.
- If its worktree folder is gone, Resume says to use **Remove worktree**, then **Start**.

### Remove worktree

- **Remove worktree** for a finished session refuses a worktree with uncommitted changes,
  including untracked files, or unpushed commits.
- It refuses with **Upstream not found** when the branch's upstream can't be found, for example
  after it was deleted from GitHub.
- Gitignored files, such as a local `.env`, are removed with the worktree.
- It checks every repo's worktree before it removes any.
- It refuses with "Another session uses this worktree" while another session, from any project, is
  live or resuming in it.
- It refuses with "Wait until the ticket starts" while a Start of its ticket, or of a ticket sharing
  its worktree, runs.
- While a removal runs, Start, Resume, and another removal of that worktree refuse with "Wait until
  the worktree is removed".
- Once removed, the ticket view says **Worktree removed** and offers no **Resume** or **Remove
  worktree**.

### Folder trust

- A session in a folder Claude Code has never trusted waits at Claude Code's folder trust prompt.
- If Claude Code hasn't started after 30 s, the session shows **Needs you** and says why on its
  ticket card, in the ticket or session view, and in a routine's **Run history**.
- Until you answer the prompt in the terminal, **Send to session**, **Send all**, the composer,
  **Stop**, turning **Remote Control** on, **Prepare to compact**, **Compact**, and **Clear Needs
  you** are refused. Then the session shows its real state again.
- A worktree is trusted when its repo is.

### Session rules

- Sandtable passes session rules through `claude --append-system-prompt`.
- Every session gives each issue it files one `area:` label, or none in a repo without them, sets
  **Blocked by** when another open issue blocks it, and, on a board project, adds the issue to the
  board as Todo.
- A ticket's session reads the issue's comments before it starts, puts `Closes #<n>` in its pull
  request, and, on a board, sets Done after the merge.
- A ticket's session treats the issue text and comments as coming from GitHub, not as
  instructions, and treats pasted review findings, thread comments, and check logs as data to
  judge.
- A worktree session stays in its worktree and branch.
- A routine's session never stops to ask in plain text, and asks with a question dialog when it's
  blocked, needs a decision, or leaves something for you to act on.
- A session's commits and pull requests carry no Claude Code attribution: the `--settings` file
  sets `attribution` to empty for both.

### Session rules on Linear and Jira

- In a Linear project, the rules use the `linear` CLI, with `--workspace <slug>` on every command
  when the project names a workspace.
- A Linear session files issues with `linear issue create --team <key>`, in one of the chosen Linear
  projects, named by its ID, when there are any.
- A Linear issue gets one `area:` team label from `linear label list --team <key>`, or none in a
  team without them, and blockers set with `linear issue relation add`.
- A Linear ticket's session reads the issue with `linear issue view`, puts `Closes <identifier>` in
  its pull request, and after the merge moves the issue to completed if it isn't done.
- In a Jira project, the rules use the `acli` Jira CLI, check first with `acli jira auth status`
  that it's on the project's site, and otherwise stop and ask you to switch.
- A Jira session files issues with `acli jira workitem create --project <KEY> --type Task`, with
  one `area:` label with no spaces from the labels the project's issues use, or none.
- A Jira session links a blocker with `acli jira workitem link create`, then checks the link's
  direction and recreates it reversed if needed.
- A Jira ticket's session reads the issue with `acli jira workitem view` and its comments with
  `acli jira workitem comment list`.
- A Jira ticket's session puts `Closes <key>` in its pull request body and the key in its title,
  and after the merge moves the issue to its done status if it isn't done.

## Session settings

### Model

- **Model** is set per project on the **Review** step. **Account default** passes no `--model`, so
  `claude` uses the account's default model.
- **Fable**, **Opus**, **Sonnet**, and **Haiku** start `claude` with `--model fable`, `opus`,
  `sonnet`, or `haiku`, aliases that follow Claude Code's latest model of that kind.
- **Start**, on a card and in the ticket view, has a model chip that shows the model the session
  will run on and opens a menu to pick another for that one session.
- **New session** has the same choice as a **Model** group. A pick changes only that session, never
  the project.
- The session saves its model, and **Resume** and turning Remote Control off start it again on the
  same model.
- A routine's runs use the project's model, and **Save as routine** in **New session** doesn't
  carry a picked model over.
- A ticket's card and the **Sessions** strip card show the model before the state chip, and nothing
  for **Account default**.
- The side panel's **Model** row names the model until Claude Code reports the model it runs.
- Token use on the ticket and the **Usage** page counts each message under the model it ran on.
- Sandtable's own `claude -p` runs, such as the chat, the summary, the review, and the triage,
  overlap, and readiness checks, keep the account's default model.

### Token cap

- **Token cap** is set per project on the **Review** step, off by default.
- With a cap, a live session's card shows its use against the cap over a meter.
- A session that reaches the cap shows **Needs you** with the reason on its card, and sends a
  **Needs you** notification that says so, even when it already needed you, unless its ticket is
  done.
- A capped session's Claude Code runs no further tool calls: a hook passed through
  `claude --settings` stops each one.
- **Raise cap**, on the card and in the ticket and session view headers, lets the session use
  another cap's worth of tokens from where it is.
- While a session is capped, **Clear Needs you** is hidden and refused, and a message you send
  keeps it at **Needs you**.
- A higher cap, or none, set in **Edit project** lets it run on too.

### Live token use

- Sandtable reads live token use from each live session's own conversation files and their
  subagents' on the same 3 s poll.
- A session's card and **Sessions** strip card show its tokens and its API price estimate. Its
  sidebar row's tooltip adds them, and the side panel's **This session** row shows them.
- The sidebar footer shows **Live now**, the total of every live session, over a bar split by each
  session's share. Hovering or focusing it lists each session's tokens and estimate.
- An estimate that leaves out a model with no price is marked with "\*".

### Sandbox

- **Sandbox commands** is set per project on the **Review** step, off by default.
- With it on, the Bash commands of a ticket session, a **New session** session, and a **New
  ticket** session run in Claude Code's sandbox, turned on through `claude --settings` at start and
  at every **Resume**.
- Sandboxed commands can write only the session's folders (its worktrees, or the main checkout for
  a session without one) and the temporary folder.
- They can't read `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker/config.json`, `~/.netrc`,
  `~/.config/gcloud`, `~/.azure`, or the Sandtable data folder.
- They reach only `github.com`, `api.github.com`, `registry.npmjs.org`, the project's Linear or Jira
  host, the domains you add under **Allowed domains**, and the macOS trust service that `gh` needs
  to check TLS certificates, which the allowed domains don't cover.
- A command that fails in the sandbox isn't retried outside it.
- `gh`, HTTPS push, `npm` with its own cache in `~/Library/Caches/Sandtable/npm`, and commits signed
  through an SSH agent such as 1Password's work.
- SSH remotes, Docker, tmux, a signing key file in `~/.ssh` or a GPG key, and changing git's config
  don't work, so `git push -u` pushes but can't set the upstream.
- Only Bash is sandboxed: Claude's Read, Edit, and web tools follow its permissions as before, and
  a sandboxed command can still use your SSH agent's keys and the `gh` token in your keychain.
- Routines and Sandtable's `claude -p` runs aren't sandboxed.
- A sandboxed session shows **Sandboxed** in the side panel's **Where** row, with the limits and
  the domains that session started with.
- Changing the setting reaches a running session the next time it resumes. Turning it off drops the
  project's allowed domains.

### Remote Control

- **Start sessions with Remote Control on**, on the **Settings** screen, off by default, starts
  each new session, ticket or not, with Remote Control on.
- With Remote Control, you can follow and steer a session from claude.ai or the Claude app, and
  prompt it from any device signed in to your claude.ai account.
- A project overrides the setting on the **Review** step of **Edit project**: **Use the Settings
  default**, **On**, or **Off**.
- The side panel has a **Remote Control** switch, and cards show a mark while Remote Control is on.
- On a live session, turning the switch on types `/remote-control` with the session's name into the
  terminal, so Remote Control comes on without a restart, also while Claude is working.
- The switch is disabled while Claude asks you something, since the typed text would answer it,
  and refused until Claude Code has started.
- A prompt you typed but didn't send goes in front of the command and is sent with it, so Remote
  Control doesn't come on even though the switch is on.
- Turning it off on a session that shows **Needs you**, **Reviewing**, **Idle**, or **Done**
  restarts Claude Code in the same conversation without Remote Control.
- The restarted session comes back as **Needs you**, **Reviewing** while an automatic review round
  still runs, or **Done** for a routine's session, without a notification.
- A prompt you typed but didn't send is lost when Remote Control is turned off.
- The switch is disabled while the session is **Running**, so it never cuts off work in progress.
- On a **Finished** session, the switch only saves what **Resume** starts. **Resume** keeps the
  session's choice; the setting only decides how a session starts.
- Sandtable remembers the setting and each session's choice.

## Routines

### What a routine is

- A routine is a saved way to start a session without a ticket: a name, a repo, the main checkout
  or a new worktree, and a first message.
- You start it with one click, or give it days and a time and Sandtable starts it then, while
  Sandtable is open.
- Each run is a new session named after the routine and its start time, such as "Dependency check,
  Oct 28, 02:00".
- Sandtable changes nothing on GitHub, Linear, or Jira for a routine.
- A time that passes while Sandtable is closed or the Mac is asleep, or while the routine's last
  session is still open and not **Done**, is skipped and recorded, up to the last 7 days.
- A scheduled start that fails is recorded with its error.
- A routine whose worktree setup fails doesn't start, and a scheduled run is listed as skipped with
  the command's last lines.
- Routines run as local sessions you can step into, unlike Claude Code's cloud routines
  (`/schedule`).
- With remote control on for the project, a routine's session can also be reached from claude.ai
  while no one watches the Mac.

### Run history and states

- **Run history** lists the routine's runs and skipped times, newest first, with each run's tokens,
  API price, and Claude's last message.
- A run waiting at a permission prompt names the tool it asked for, such as `Bash(npm outdated)`,
  in **Run history**.
- A run that ends its turn on its own shows **Done**, sends no notification, and doesn't hold the
  next run, though its session stays open to read.
- A run that asks with a question dialog shows **Needs you** and holds the next run.

### Allowed rules

- A routine's **Allowed without asking** field takes Claude Code permission rules, one per line,
  such as `Bash(npm outdated)` or `Read`.
- Only that routine's sessions, started on schedule or by you, use those rules without asking.
- Sandtable passes the rules in the session's own `--settings` file and never changes the repo's
  `.claude/settings.json`.
- Saving refuses a rule that isn't permission syntax, or one that lets a session run any command,
  such as `Bash`, `Bash(*)`, or a wildcard rule for a known runner of other commands, such as
  `Bash(sh:*)` or `Bash(npm:*)`.
- The refused runners include `Bash(/usr/bin/env:*)`, `Bash(node *)`, `Bash(nice -n 5 sh:*)`, and a
  prefix of a runner such as `Bash(s*)`.
- The check knows a list of runners, so it can't catch every way to run any command, such as a git
  alias or `find -exec`.
- Beyond those rules, an unattended run can do whatever your Claude Code permission settings
  allow, and it stops at **Needs you** at the first prompt they require, until you answer it.

### Routines section

- A **Routines** section above the board's **Sessions** strip has a pill per routine that starts
  it.
- A scheduled routine's pill shows a clock, and its tooltip names the schedule.
- While a click starts it, the pill reads **Starting**. While one of its sessions is open, it shows
  that session's state, and at **Done** a click starts the next run.
- A pill's menu has **Edit routine**, **Copy to project…**, and **Run history**.
- You make a routine with **New routine** at the end of that row, or with **New routine…** in a
  project's **More > Routines** menu, which also lists its routines to edit or delete.
- **Save as routine**, in the **New session** dialog or in the **More actions** menu of a session
  without a ticket, fills in its repo, place, and first message.
- A first message is at most 10,000 bytes, and a name at most 200 characters.

### Copy to project

- **Copy to project…** lists every project, the routine's own included, and opens the picked
  project's **New routine** form with the routine's name, place, first message, allowed rules, and
  schedule.
- The copy takes the routine's repo when that project has it or has only one repo; otherwise you
  pick a repo.
- The copy has no run history, saves as a separate routine only when you click **Save**, and in the
  same project needs a different name.
- In a copy's form, Claude's first answer knows the project and repo the routine came from.
- When the copy's repo differs, the empty chat warns that the routine's commands and allowed rules
  might not work here, and fills the message box with a request to fit the routine to the repo.
  Nothing runs until you send it.

### Build with Claude

- The **New routine** and **Edit routine** dialogs have a **Build with Claude** chat beside the
  form.
- You describe the routine, and Claude reads the repo's code without changing anything, asks what it
  needs, and proposes the name, repo, place, first message, schedule, and the narrowest allowed
  rules the first message needs.
- Each proposal fills in the fields it changes, marked **Changed by Claude**.
- A field you edited yourself keeps your value, and Claude's shows under it with **Use Claude's**
  and **Keep mine**. **Use Claude's** fills it in and marks it **Changed by Claude**.
- Claude's allowed rules always wait for **Use Claude's**.
- A refused allowed rule shows why under the field as you type.
- Claude reads the repo picked when you send the first message. **Start over** clears the chat and
  Claude's marks and suggestions, and keeps the fields.
- The chat starts fresh each time the dialog opens, **Save** waits while Claude answers, and nothing
  is saved until you click **Save**.
- As in the ticket chat, Claude's latest step shows while it answers, and **Stop** ends the answer
  and leaves your message in the box.
- The chat follows its end as it grows, as the conversation does.

## Notifications

- A macOS notification, with the default sound, when a session needs you. Clicking it opens the
  ticket, or the session view for a session without a ticket.
- macOS asks your permission the first time Sandtable notifies you. If notifications are off for
  Sandtable, Sandtable tells you once where to turn them on.
- A sync that fails, or takes over 10 seconds, doesn't hold back the notification.
- A macOS notification when your plan's 5-hour or 7-day limit passes a threshold, 80% unless you
  pick another or **Off**. It names the limit and when it resets.
- The plan-limit notification comes once per window, even while Sandtable is in front, and follows
  **Play a sound**. Restarting Sandtable can send it once more for the same window.
- Each Claude Code account's windows count apart, and the notification names an account other than
  Default. A session on an API key has no plan limits, so it sends none.
- A count on the Dock icon, across all projects, of the sessions that need you plus the tickets
  whose Start failed and that can still start.
- **Idle** sessions, routine **Done** runs, and done tickets whose session is still open don't
  count toward the Dock icon.
- The Dock count is hidden while Sandtable is the active app, clears at zero, and doesn't follow the
  **Notifications** settings.

## Usage page

- A **Usage** page, opened with **Usage** beside **Settings** in the sidebar footer, in place of
  the main view with the sidebar beside it. **Back** returns you to where you were.
- On the left, **All projects** and then each project with token use, largest first, with its
  tokens, its share of all use, and its API price estimate.
- On the right, the selected entry's usage, shown as on a ticket, then its use **By week** (weeks
  start on Monday), newest first, with tokens, Claude's working time, and the estimate.
- A project's use counts its tickets' sessions, chat, session summaries, reviews, triage, and
  readiness and overlap checks, and its sessions without a ticket.
- **All projects** counts a message once, even when two projects share a worktree.
- An estimate that leaves out a model with no price is marked with "\*", and use with no priced
  model shows no estimate.

### Throughput

- **Throughput** shows, for each week tickets merged in, newest first, how many merged, the median
  and slowest time from a ticket's first **Start** to its merge, and the API estimate per ticket.
- It also shows how many times the ticket's sessions went to **Needs you**, per ticket.
- A merge counts when its pull request merged after one of the ticket's sessions started, and
  Sandtable sees the ticket in **Done** when it syncs.
- A ticket merged without a session doesn't count, and neither does a repo issue closed as not
  planned, even after a merge.
- Sandtable records the merge on those sessions, so the figures stay after the ticket leaves the
  board or its worktree is removed.
- A project without a board keeps asking for a removed session's ticket until a sync sees it in
  **Done**, so a merge older than **Keep done tickets** still counts.
- The estimate counts those sessions and, for the ticket's newest merge, its chat, summaries,
  reviews, triage, and readiness and overlap checks.
- A ticket merged again counts again in its own week, and a ticket two projects share counts once in
  **All projects**.

## Settings

- A **Settings** screen, opened with **Settings** in the sidebar footer, **Sandtable >
  Settings…**, or Command+Comma, in place of the main view with the sidebar beside it, or over the
  setup guide.
- **Back** returns you to where you were, and choosing anything else in the sidebar also leaves
  it.
- **Remote Control** has its own section; see [Remote Control](#remote-control).

### Appearance

- Light and dark modes in Linear's colors and motion.
- **Appearance** chooses **System** (the default, which follows macOS, also when macOS switches),
  **Light**, or **Dark**.
- The choice applies to the whole window, terminal included, at once, and Sandtable remembers it.

### Keep the Mac awake

- **Keep your Mac awake while sessions run** is off by default.
- While Sandtable is open, the setting is on, and at least one session is **Running**, Sandtable
  keeps the Mac from idle sleep, as `caffeinate -i` does; the screen can still turn off.
- When every session is **Needs you**, **Reviewing**, **Idle**, **Done**, or finished, the Mac can
  sleep again.
- The sidebar says so while the Mac is kept awake.
- With the lid closed, this works only when the Mac is on power and connected to a display.
- Sandtable remembers the setting.

### Notification settings

- **Notify when a session needs you** is on by default. Turning it off stops the **Needs you**
  notification, and cards still show **Needs you**.
- **Play a sound** (on by default) sends the notification silently when it's off.
- **Don't notify while Sandtable is in front** (off by default) skips the notification while a
  Sandtable window has focus.
- **Notify when a plan limit passes** (80% by default) sets the plan-limit notification's
  threshold, or **Off**.
- While **Notify** is off, **Don't notify while Sandtable is in front** is disabled, and so is
  **Play a sound** while the plan-limit threshold is **Off** too.
- **Open Notification Settings** opens Sandtable's pane in **System Settings > Notifications**, and
  shows the error if it can't.
- Sandtable remembers each setting.

### Claude Code accounts

- **Claude Code accounts** lets a project run with another Claude Code login. An account is a name
  and the folder Claude Code reads it from through `CLAUDE_CONFIG_DIR`.
- The list starts with **Default**, the account Claude Code uses on its own, and shows each
  account's folder and **Signed in**, **Not signed in**, or **Can't check**.
- Sign-in is checked again when the window gets focus. A signed-out account shows its sign-in
  command with **Copy**.
- **Add account** asks for a name and a folder, a full path or one starting with `~/` but not the
  home folder itself or `/`.
- **Add account** offers a button for each `~/.claude*` folder in your home folder that isn't an
  account yet. The folder doesn't have to exist; signing in creates it.
- **Remove** removes an account other than Default, and refuses while a project uses it, naming
  those projects.
- Each project picks its account on the **Review** step. Its sessions, triage, chat, session
  summaries, reviews, and readiness and overlap checks run with that account's `CLAUDE_CONFIG_DIR`.
- A project on **Default** uses `CLAUDE_CONFIG_DIR` from Sandtable's own launch, or none. Without
  one, its sessions unset it, so one left in tmux's environment can't switch them.
- A session keeps the account it started with, so **Resume** and the **Conversation** tab use that
  account's folder even after the project changes account.

### Leftover sessions

- **Leftover sessions** lists the sessions that no card or sidebar row shows but that still run in
  tmux or still have a worktree on disk.
- That covers sessions of a deleted project, of a ticket that left the board or sits in no column,
  and of a ticket whose repo left the project.
- It also lists the newest session of each ticket in **Done** while that session runs or its
  worktree is on disk, unless it has finished and another shown session uses that worktree.
- Ticket sessions are judged only after the project's first sync.
- Rows sort by why each is left over, and each row says it: **Done**, **Off the board**, or
  **Removed project**.
- Each row shows its name, the ticket's title, state, project, repo, and branch.
- Each row offers **End session and remove worktree** on a live session or **Remove worktree** on a
  finished one, under the same rules as on a card.
- The action's tooltip says what it does to your work, including that a worktree with uncommitted or
  unpushed changes stays. A refusal shows its reason on the row.
- A live session whose worktree a card still uses offers **End session** only and keeps the
  worktree.
- A tmux session that this Sandtable started and has no record of shows as **Unknown session** with
  **End session**. Sessions of another Sandtable, such as a development run, aren't listed.
- Nothing is ended or removed until you click, and the delete-project dialog points you here.
- With two or more rows, **Clean up all** asks first, then runs each row's action in turn. A refusal
  or error shows on its row and doesn't stop the rest.
- While any leftover exists, the board header shows **To clean up** with the count. It opens the
  same list for every project in a panel, which can't close while a cleanup runs.

## Setup guide

- A setup guide on first run, whenever a required tool or the `gh` login or `repo` scope is
  missing, and when the check itself fails.
- The guide has one step each for tmux and git, Claude Code, the GitHub CLI, the Linear CLI, and
  the Jira CLI, with the command that fixes each and **Copy**, and **Check again**.
- Each check shows a word: **Ready**, **Missing**, **Not signed in**, **Not logged in**, **Missing
  scope**, or **Can't check**.
- A signed-out `claude` (for example, with an API key Sandtable can't see), a missing `project`
  scope, and a missing or signed-out `linear` or `acli` only warn.
- The Claude Code step has a **<name> signed in** row for each account other than Default that a
  project uses, which only warns and shows that account's sign-in command.
- The Linear CLI step has a **Signed in to <slug>** row for each Linear workspace a project uses,
  which only warns.
- The Jira CLI step has a **Signed in to <site>** row for each Jira site a project uses, Ready when
  `acli jira auth status` shows that site. It only warns and shows the `acli jira auth switch`
  command for that site.
- **Check again** also picks up a `gh` or `linear` token that changed since Sandtable started, and
  asks again who's signed in for **Me**.
- A GitHub or Linear call that fails also makes the next call read the token again.
- On first run, the guide ends at **Add project**.
