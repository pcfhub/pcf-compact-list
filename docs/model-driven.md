---
title: Model-driven apps
description: Adding Compact List to a form.
order: 4
---

# Using it on a model-driven form

Compact List binds a view, so it replaces a **subgrid** — not a field.

:::steps
1. Open the form in the modern form designer.
2. Add a **subgrid** where you want the list, and point it at the table and view
   you want to show.
3. With the subgrid selected, open **Components → Add component** and choose
   **Compact List**.
4. Enable it for **Web**, **Phone** and **Tablet** as appropriate.
5. Save and publish.
:::

::image{src=media/screenshot.png alt="An Accounts subgrid rendered by Compact List: each account name is a link, with Status, Status Reason and Created On on labelled lines beneath it, and Previous page disabled on the first of two pages" zoom}

## What the view controls

Everything about which columns appear:

| View metadata | Effect |
| --- | --- |
| The columns you add | The lines each item shows, capped by **Detail lines** |
| Their order | The order of the lines |
| Hidden columns | Skipped entirely |
| The primary column | Becomes the title line, unless **Title column** overrides it |
| Sort order | The order of the records; the control does not re-sort them |

:::callout{type=info}
There is nothing to configure per column, and no column pickers in the
properties pane. Change the view and the list follows. This is why the control
declares no `property-set` roles — a role is a fixed slot, and the point here is
that the view decides.
:::

## Column types

Any of them. Every value is read through `getFormattedValue()`, which is the
platform's own formatting — so currency arrives with its symbol, a choice
arrives as its label rather than its number, a date arrives in the user's
format, and a lookup arrives as the record's name.

That has one consequence worth knowing: the control never sees a raw value, so
it cannot right-align numbers or colour a choice. If you need either, you want a
table.

## Configuration worth setting

| Property | Type it exactly as | Notes |
| --- | --- | --- |
| Title column | `name`, `subject`, `fullname` … | The column's **logical** name, not its display name. A name that matches nothing falls back to the primary column. |
| Paging | `pager` or `loadMore` | |
| Density | `comfortable` or `compact` | |

## The subgrid's own chrome

The command bar, view selector and quick find are **off**. Compact List does not
report a selection, so there is nothing for a ribbon button to act on, and the
list is a reading surface rather than a grid you operate.

If you need the ribbon, you need selection, and that means
[Data Table](https://pcfhub.dev/components/pcf-data-table).
