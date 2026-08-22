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

## Not supported

- **Grouping and headers.** No section breaks, no sticky group titles.
- **Inline editing.** The list reads; it does not write. The only thing it
  writes back is the id of the record whose title was clicked.
- **Drag to reorder.** The order is the view's.

If you want columns, sorting and selection, use
[Data Table](https://pcfhub.dev/components/pcf-data-table) — it is the same
family of control, sized for the case where you have the width.
