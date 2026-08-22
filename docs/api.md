---
title: API reference
description: Properties and outputs, generated from the control manifest.
order: 5
---

# API reference

<!--
  Do not write the property tables by hand.

  `props-table` renders from what the hub parsed out of
  ControlManifest.Input.xml at the release being viewed, so it cannot drift from
  the control. A hand-written table is wrong the first time somebody adds a
  property and forgets this file, and a reader has no way to tell.

  kind: input | bound | output | dataset | dataset_column
  Omit `kind` to render every property in one table.

  There is no `kind=bound` section here because a dataset control binds a
  collection, not a column.

  There is no `kind=dataset_column` section either, because the manifest this
  ships with declares no `property-set` roles — the directive would render an
  empty table, which reads as "this control has no dataset columns" rather than
  as a section nobody wrote. **If you add roles to the manifest, add the section
  back**, or the roles you declared are documented nowhere.
-->

## Input properties

::props-table{kind=input}

## Dataset

::props-table{kind=dataset}

## Outputs

::props-table{kind=output}

## Columns

The columns are the view's.

This control declares no `property-set` roles, so there is no per-column
configuration to document — it renders whatever `dataset.columns` reports: the
columns the maker put in the view, in the view's own `order`, minus the ones
marked hidden.

| Metadata | Effect |
| --- | --- |
| `order` | The order of the detail lines. |
| `isHidden` | Skipped entirely. |
| `isPrimary` | Becomes the title line, and names the item for a screen reader. Overridden by the **Title column** input; falls back to the first visible column. |
| `displayName` | The label on each detail line, whether or not **Show labels** draws it. |

`visualSizeFactor` and `disableSorting` are read by table-shaped controls and
are ignored here — this one has no widths to distribute and no headers to sort
by.

## How values are read

Every value comes from `getFormattedValue()`, the platform's own formatting. A
currency arrives with its symbol, a choice as its label, a date in the user's
format, a lookup as the record's name. The control never sees the raw value,
which is why it cannot align or colour by type.

A value that formats to an empty string is **skipped**, not rendered blank.
