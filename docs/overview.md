---
title: Overview
description: What Compact List does, and when to reach for it.
order: 1
---

# Compact List

A Dataverse view as a stacked list of records, for narrow spaces.

::image{src=media/screenshot.png alt="Compact List on an Accounts subgrid: three accounts as stacked items, each with its name as a link above labelled Status, Status Reason and Created On lines, over a pager reading 1–3 of 6" zoom}

Each record becomes one item: a title line taken from the view's primary column,
and a few detail lines beneath it. There is no header row and nothing scrolls
sideways.

## Why this one

A subgrid is a table, and a table needs width. Put one in a form's side column,
a narrow section, or a phone layout and the columns either squeeze into
unreadable slivers or push a horizontal scrollbar under the rows — and a
horizontal scrollbar inside a vertically scrolling form is the interaction
everyone has learned to dislike.

Compact List trades the grid for a stack. Values go under the title rather than
beside it, so the control needs no more width than its longest word and gets
shorter as you hide columns rather than wider as you add them.

Two smaller things follow from the same idea:

- **Empty values are skipped.** A table has to hold the cell open because the
  column is still there. A list does not, so a record missing a phone number
  simply has one fewer line — not a blank one.
- **It is small.** No React, no Fluent, no platform libraries: the whole control
  is one file of DOM. If you are weighing what a canvas app has to download,
  that matters more here than the feature list does.

Reach for [Data Table](https://pcfhub.dev/components/pcf-data-table) instead when
you have the width and want columns, sorting and row selection. This control has
none of those, deliberately.

## Searching it

Turn on **Show search** and a box appears above the list. Type into it and,
after a short pause, the control asks the platform to re-query: it builds a
filter of `Like` conditions across the view's text columns, resets the page,
and calls `refresh()`. What comes back is a different set of records, not a
subset of the ones already on screen.

- **Server-side is the whole point.** A control that filters the records it
  already has narrows 25 rows out of 240 — a wrong answer that looks completely
  right, and one nobody notices until a record that should have matched is
  missing. This one asks the server, so the result covers the view.
- **It searches columns, not a fixed one.** With **Search columns** empty it
  searches every text column the view carries; naming two or three indexed ones
  is the difference between a search that returns and one that times out on a
  large table.
- **What a user types is treated as text.** `%` and `_` are SQL wildcards, and
  they are escaped before the query is sent. Without that, typing `%` matches
  every record in the table.

Two outputs come with it — **Filtered record count** and **Search term** — so a
canvas app can say "no results for *contoso*" in its own words.

Search is off by default. A list that never asked for a box never grows one.

## What it works with

:::callout{type=info}
Model-driven forms, canvas apps and custom pages. It binds a **view**, not a
column, so on a form it goes on a subgrid rather than on a field.
:::

The columns are the view's own — whatever the maker put there, in the order they
put them, minus the hidden ones. There is nothing to configure per column, and
switching the view changes what the list shows without touching the control.

## Configuring it

Everything is optional. The defaults render a labelled three-line item with a
pager.

| Property | Default | |
| --- | --- | --- |
| Paging | Pager | Whether further pages replace the list or append to it |
| Title column | *(the view's primary column)* | Logical name of the column to use as the title line |
| Detail lines | 3 | How many further columns to show beneath it |
| Show labels | On | Prefix each detail line with its column name |
| Density | Comfortable | How much vertical space each item takes |
| Open on click | On | Make the title a button that opens the record |
| Show search | Off | Put a search box above the list that filters the view server-side |
| Search columns | *(every text column in the view)* | Logical names to search, comma-separated |
| Match | Starts with | Whether a term matches the start of a value or anywhere inside it |
| Minimum characters | 2 | How much has to be typed before the view is filtered |
| Typing pause (ms) | 300 | How long to wait after the last keystroke before querying |

The full list, generated from the control manifest, is on the
[API reference](api.md) page.
