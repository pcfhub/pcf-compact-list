---
title: FAQ
description: Questions that come up more than once.
order: 8
---

# FAQ

## Why does the control not appear in the component list?

Two usual causes. Either customizations were not published after the import, or
you are looking at a **field**'s component list — Compact List binds a dataset,
so it only offers itself on a subgrid. See
[Model-driven apps](model-driven.md).

For canvas, **Code components for canvas apps** has to be enabled for the
environment before any code component appears under **Insert → Code
components**.

## Why is a column I added to the view not showing?

Most likely **Detail lines**. It defaults to 3, so a view with six columns shows
the title and the next three. Raise it to show more, or reorder the view so the
columns you care about come first — the control takes them in the view's own
order.

Otherwise: hidden columns are skipped, and the column used as the title is not
repeated in the detail lines.

## Can I choose which column is the title?

Yes — **Title column**, typed as the column's *logical* name (`name`, `subject`,
`fullname`), not its display name. Leave it empty and the view's primary column
is used. A name that matches nothing falls back rather than showing a list of
dashes, which means a typo looks like "my setting did nothing" rather than like
an error.

## What is the difference between the two paging modes?

**Pager** replaces the records on screen and gives you Previous and Next.
**Load more** appends the next page beneath the current one and the list grows.

Load more is the better fit for reading and for touch — you do not lose your
place. Pager is better when you want to know where you are in a large set. Both
fetch a page at a time either way; the difference is what happens to the records
already on screen.

## Can I sort by clicking a heading?

No — there are no headings. The records come in the view's order. This is a
[limitation by design](limitations.md); if you want sorting you want
[Data Table](https://pcfhub.dev/components/pcf-data-table).

## Does it work on a phone?

That is what it is for. Set **Density** to `compact`, **Detail lines** to 1 or
2, and **Show labels** off. The labels stay in the accessibility tree even when
they are not drawn, so a screen reader still announces what each value is.

## Why does the demo on this site not page?

The demo harness serves the whole fixture as a single page and reports that
there is no next page, so Previous and Next are disabled and **Load more** never
appears. That is the harness, not the control — which is why the demo is marked
*limited* rather than *full*.

## How do I report a bug?

Open an issue at <https://github.com/pcfhub/pcf-compact-list/issues>, with the
platform version and the control version from the solution.
