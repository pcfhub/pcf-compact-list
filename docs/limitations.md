---
title: Limitations
description: What Compact List does not do.
order: 7
---

# Limitations

Most of these are the shape of the control rather than gaps in it. Where that is
true it says so, because a constraint you chose and a job not yet done deserve
different reactions.

## By design

- **No sorting.** A table sorts by clicking a column header, and this control
  has no headers to click. The records arrive in the view's own order; change
  the view's sort to change theirs. Sorting a dataset is applied server-side
  across every page, so a control-level sort control would have to re-fetch —
  which is a table's interaction, not a list's.
- **No selection.** No checkboxes, no `SelectedItems`, and nothing reported to a
  model-driven command bar. The subgrid's ribbon is therefore off; there would
  be nothing for its buttons to act on.
- **No per-column configuration.** No widths, no alignment, no formatting, no
  colour. The control declares no `property-set` roles precisely so that the
  view stays in charge, and the cost of that is that there is no per-column
  anything to configure.
- **Values are the platform's formatted strings.** Every value is read through
  `getFormattedValue()`, so the control never sees a number as a number. It
  cannot right-align a currency or colour a choice.
- **Empty values are dropped, not blanked.** A record missing a phone number
  shows one fewer line. If you need the blanks visible — to see at a glance
  which records are incomplete — a table is the better tool.

## Worth knowing

- **Long lists are rendered in full.** There is no virtualisation: every record
  on the current page becomes DOM. That is fine at a page size of 25 or 50 and
  it is not fine at 250, especially in **Load more** mode where pages
  accumulate. Keep the page size at a screenful or two.
- **Changing the page size restarts a Load more list.** A new page size has to
  be requested from the platform and the request refreshes the dataset, which
  discards everything accumulated so far. Set it once in the properties pane
  rather than treating it as a runtime control.
- **Switching paging mode restarts the list too**, for the same reason and
  deliberately: appending page four onto a list showing only page three is not a
  state worth reasoning about.
- **`totalResultCount` is not always known.** On large views the platform
  declines to count, and the footer then says "Page 3" or "40 shown" rather than
  naming a total. That is the platform's answer, not a fallback for an error.

## Search

All of these apply only with **Show search** on.

- **It searches text columns only.** A `Like` condition against a whole number,
  a currency or a lookup is a query the server rejects, so those columns are
  never included. A view of nothing but numbers and lookups has nothing to
  search: the box is disabled and says so, rather than accepting keystrokes that
  could not do anything.
- **One term, matched the same way in every column.** There is no field-by-field
  search, no ranges and no operators in the box — a term is a term, and it goes
  to every searched column as an `Or`. If you need "amount greater than", this is
  not the control.
- **`Contains` cannot use an index.** `%term%` makes the server read every row.
  On a large table that is the difference between a search and a timeout, which
  is why `Starts with` is the default.
- **The condition operators differ between hosts, and not symmetrically.** From
  the platform's own table: `NotLike` and `NotNull` are canvas-only;
  `Yesterday`, `Today` and `Tomorrow` are model-driven-only. This control uses
  only `Like`, which is supported on both — so it behaves identically, at the
  cost of not offering anything cleverer.
- **A search restarts a Load more list.** The filter resets the page before it
  refreshes, so an accumulated list collapses to page one of what matched. That
  is the right answer — the records that were accumulated are not a prefix of
  the filtered set — but it means the record you were reading does not stay
  where it was, the way it does across a plain Load more.
- **A subgrid's own quick-find is not reconciled with this.** The manifest leaves
  `cds-data-set-options` off so neither box is shown; turning quick-find on gives
  you two search boxes over one view, filtering by different means. There is no
  setting here that makes them agree.
- **A wrong column name reaches the server, on purpose.** Entries in **Search
  columns** that cannot be a logical name are dropped, but one that could be a
  column and is not gets sent — because the server's rejection is the only thing
  that will ever name it. A silently dropped name leaves a search that quietly
  ignores a column nobody can find.
- **Case sensitivity follows the database.** Dataverse's default collation is
  case-insensitive and the control assumes nothing else; on a case-sensitive
  deployment `Starts with` would behave differently from what these pages
  promise.
- **The demo on the hub cannot filter.** Filtering is server-side and the demo
  harness has no server behind it, so typing narrows nothing there. What the
  demo does show — and it is the interesting half — is the call log: the
  debounce, the expression, the paging reset, the refresh.

## Not supported

- **Grouping and headers.** No section breaks, no sticky group titles.
- **Inline editing.** The list reads; it does not write. The only thing it
  writes back is the id of the record whose title was clicked.
- **Drag to reorder.** The order is the view's.

If you want columns, sorting and selection, use
[Data Table](https://pcfhub.dev/components/pcf-data-table) — it is the same
family of control, sized for the case where you have the width.
