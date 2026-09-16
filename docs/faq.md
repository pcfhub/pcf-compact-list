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

## Where is the search box?

**Show search** is off by default. Turn it on and the box appears above the
list. It filters the view server-side, so the results cover the whole view
rather than the records already on screen — see [Overview](overview.md).

## The search box is greyed out. Why?

There is nothing in the view for it to search. The query is built from `Like`
conditions, which the server rejects against numbers, dates and lookups — so a
view of only those columns has no searchable column. Add a text column to the
view, or name one in **Search columns**.

## Why does nothing happen until I have typed two characters?

**Minimum characters**, which defaults to 2. Below it the control asks the
platform for nothing at all — not a filter that matches everything. Searching on
the first keystroke sends `a%` across every text column of the table, which is
the most expensive query the control will ever send and the least useful.

## Searching for a word in the middle of a name finds nothing.

Set **Match** to `contains`. The default is `startsWith`, which sends `term%`
and can use an index; `contains` sends `%term%`, which cannot. On a small view
the difference is invisible — on a large one, see
[Limitations](limitations.md).

## Can I search a column that is not in the view?

Name it in **Search columns**. The property takes logical names and is not
limited to what the view displays — a column the maker did not add is still a
column the server can filter on.

Be deliberate about it though: a match on a column nobody can see is a result
the user cannot account for.

## I named a search column and nothing changed.

Two possibilities. If it cannot be a logical name — a space, a capital, a
comma-separated fragment that is really prose — the control drops it, because
that is where free text stops being data and starts being part of a query. If it
looks like a logical name but is not a column on this table, the control sends
it and the server rejects the query; check the browser console and the form's
own error for the column name.

## I was using View Filter. What now?

View Filter is superseded by this control with **Show search** on. The search
properties have the same names; `itemClick: none` becomes **Open on click**
off; and `detailColumns` is the same. Remove View Filter from the subgrid, add
Compact List, and copy the values across. The two are different controls, so
the swap is by hand — there is no in-place upgrade from one to the other.

## Why does searching do nothing in the demo on the hub?

Filtering is server-side and the demo harness has no server behind it. The call
log below the demo is the part worth watching: the debounce, the expression, the
paging reset and the refresh are all real.

## How do I report a bug?

Open an issue at <https://github.com/pcfhub/pcf-compact-list/issues>, with the
platform version and the control version from the solution.
