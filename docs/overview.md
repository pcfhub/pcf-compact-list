---
title: Overview
description: What Compact List does, and when to reach for it.
order: 1
---

# Compact List

A Dataverse view as a stacked list of records, for narrow spaces.

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

The full list, generated from the control manifest, is on the
[API reference](api.md) page.
