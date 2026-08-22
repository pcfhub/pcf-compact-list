---
title: Examples
description: Worked configurations of Compact List.
order: 6
---

# Examples

## Recent cases in a form's side column

The case most people arrive with: a related-records subgrid that has to live in
a narrow column where a table would need a horizontal scrollbar.

Add a subgrid pointing at **Cases → Active Cases**, with the view containing —
in this order — Case Title, Customer, Priority and Created On. Then:

| Property | Value |
| --- | --- |
| Paging | `pager` |
| Detail lines | `3` |
| Show labels | On |
| Density | `comfortable` |
| Open on click | On |

Each item reads as the case title in link blue, with *Customer:*, *Priority:*
and *Created On:* beneath it. Clicking the title opens the case.

The lines come from the view, so adding a fifth column to it changes nothing
until you raise **Detail lines** — which is the intended way round. Widen the
control rather than the data.

## A phone layout that has to stay short

Same view, tuned for a screen where vertical space is the scarce thing:

| Property | Value |
| --- | --- |
| Paging | `loadMore` |
| Detail lines | `1` |
| Show labels | Off |
| Density | `compact` |
| Open on click | On |

One line under each title, no label text, tighter spacing. **Load more** appends
the next page under the current one instead of replacing it, so a thumb scrolls
forward without losing its place — and the label is still read out by a screen
reader even though it is not drawn.

## A read-only list in a canvas app

A list that reports what was tapped and navigates itself, with no link styling:

```powerfx
// Items
SortByColumns(
    Filter(Accounts, 'Status Reason' = 'Status Reason (Accounts)'.Active),
    "name"
)
```

| Property | Value |
| --- | --- |
| Open on click | `false` |
| Title column | `"name"` |
| Detail lines | `2` |

With **Open on click** off, the titles are plain text and the control writes
nothing. Turn it back on and handle `OnChange` if you want the navigation —
see [Canvas apps](canvas.md) for the formula.

:::callout{type=success}
Every property above is optional. Placing the control with nothing configured
gives you the first example's shape against whatever view the subgrid is
pointed at.
:::
