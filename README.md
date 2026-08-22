# Compact List

A Dataverse view as a stacked list of records, for narrow spaces.

[![Build](https://github.com/pcfhub/pcf-compact-list/actions/workflows/build.yml/badge.svg)](https://github.com/pcfhub/pcf-compact-list/actions/workflows/build.yml)
[![Release](https://github.com/pcfhub/pcf-compact-list/actions/workflows/release.yml/badge.svg)](https://github.com/pcfhub/pcf-compact-list/actions/workflows/release.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/pcf-compact-list), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

<!--
  This README is for someone standing in the repository — a maintainer, or
  somebody deciding whether to install the control. The hub publishes `docs/`,
  not this file, so do not duplicate the documentation here.

  The three sections below are the ones worth writing by hand. Everything after
  them is the same in every repository and needs no edits.
-->

## What it does

Renders a dataset — a subgrid's view, a canvas `Items` table — as a stack of
items rather than a grid. Each record gets a title line from the view's primary
column and a few detail lines beneath it. No header row, and nothing scrolls
sideways.

The case it exists for is width. A subgrid in a form's side column or a phone
layout has to squeeze its columns or grow a horizontal scrollbar, and neither is
good. Stacking trades vertical space, which a form already scrolls, for the
horizontal space it does not have.

Three decisions a reader might otherwise question:

**No `property-set` roles.** A role is a fixed slot — declare `titleField` and
`subtitleField` and the control is capped at exactly those. What this control
needs instead already exists on `dataset.columns`: which column is primary, what
order they go in, which are hidden, what each is called. So the view decides,
and `titleColumn` is a plain input for the one case where `isPrimary` names the
wrong column. The cost is that there is no per-column configuration at all, and
that is deliberate rather than unfinished.

**Empty values are skipped, not blanked.** A record with no phone number shows
one fewer line. A table has to hold the cell open because the column is still
there; a list has no grid to hold open, and a run of empty lines is exactly what
separates this from a table with its headers switched off.

**The two paging modes are one platform call with different arguments.**
`loadNextPage(true)` turns the page. Bare `loadNextPage()` returns the whole page
range, so `sortedRecordIds` accumulates and the list grows — which is documented
elsewhere as the trap a table falls into, and is precisely what a list wants.
See `SPEC.md`; the accumulate path is reasoned from the type definitions and has
not been observed against a real view.

**Standard, not React.** No React, no Fluent, no `<platform-library>` entries —
one file of DOM. See the bundle numbers in `SPEC.md`, which are less lopsided
than that makes it sound.

## Properties

All optional. `docs/api.md` generates its tables from the manifest; this one is
hand-written, so it stays short.

| Property | Type | Usage | Default | What it controls |
| --- | --- | --- | --- | --- |
| `records` | dataset | bound | — | The view or table to render |
| `pageSize` | Whole.None | input | `25` | Records requested per page; clamped to 1–250 |
| `paging` | Enum | input | `pager` | `pager` turns pages, `loadMore` appends them |
| `titleColumn` | SingleLine.Text | input | — | Logical name of the title column; empty uses `isPrimary` |
| `detailColumns` | Whole.None | input | `3` | Further columns shown beneath the title; `0` is title-only |
| `showLabels` | TwoOptions | input | `true` | Draw each detail line's column name |
| `density` | Enum | input | `comfortable` | `comfortable` or `compact` |
| `openOnItemClick` | TwoOptions | input | `true` | Title is a button calling `openDatasetItem()` |
| `openedRecordId` | SingleLine.Text | output | — | Id of the record whose title was last clicked |

`showLabels` off hides the `<dt>` in CSS rather than omitting it, so a screen
reader still announces what each value is.

Strings ship in **English (1033) only**. The sibling controls carry five
languages; this one does not yet.

No `<feature-usage>` is declared, because nothing is used — no Web API, no
device, no navigation. Installing it presents no permission prompt.

## On the hub

`demo.fidelity` is **`limited`**, and the limitation is the harness rather than
the control. The demo serves the whole fixture as a single page and reports no
next or previous page, so the pager renders disabled and **Load more** never
appears at all — which means the demo cannot show the difference between the two
paging modes, the one thing most worth seeing. `openDatasetItem()` is a logged
mock call there too, though `openedRecordId` still updates.

`full` would be a lie for a dataset control that pages, and `mocked` would claim
the interactions work against simulated data when paging does not work there at
all.

Two presets: **Comfortable** (three labelled lines, pager) and **Compact, no
labels** (two unlabelled lines, tighter spacing, load-more). The fixture is 24
accounts in `demo/records.json`, several with deliberately empty values so the
skip-empty behaviour is visible.

## Install

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-compact-list/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm start          # the PCF test harness
npm run build
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
```

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `CompactList/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Tag it: `git tag v1.2.3 && git push --tags`

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `CompactList/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
