# Compact List

A Dataverse view as a stacked list of records, for narrow spaces.

## What it does

Binds a dataset and renders it as a `<ul>` of items — a title line from the
view's primary column, then up to *n* detail lines as a `<dl>` beneath it —
rather than as a table. It declares **no `property-set` roles** for the same
reason `pcf-data-table` does not: a role is fixed arity, and the metadata a
layout needs (`order`, `isPrimary`, `isHidden`, `displayName`) exists on real
view columns and nowhere else.

The decision that shaped the rest is that the two paging modes are the *same
platform call with different arguments*. `loadNextPage(true)` turns the page;
bare `loadNextPage()` returns the whole page range and `sortedRecordIds`
accumulates. Everything written about that call so far treats the bare form as
a trap, because everything written about it so far was written for a table.

## Why this control exists

It is the first repository to run `scripts/setup.mjs --type dataset` **without**
`--framework react`. `_template`'s own `TEMPLATE.md` claimed all four
type × framework combinations were supported, and three of them had a
repository proving it. `variants/dataset/index.ts` — roughly 300 lines of
hand-written DOM — had never been compiled by anything.

It is now. See "What the scaffold got right" below.

## What was verified

Windows 11, Node 22.13.1, npm 10.9.2, `@types/powerapps-component-framework`
**1.3.18**, `pcf-scripts` **1.51.1**, TypeScript **5.9.3**, msbuild from Visual
Studio 18 Community.

| Step | Result |
| --- | --- |
| `node scripts/setup.mjs --yes --type dataset …` | Succeeded. 30 files rewritten, 8 renamed. `variants/`, `TEMPLATE.md` and `docs/migration.md` removed as documented. |
| `npm run check` | "Template adopted, pcfhub.json readable, control shape agrees with the manifest, docs named correctly, media present." |
| `npm run refreshTypes` | Succeeded. `IInputs.records` typed as `DataSet`; both Enums generated as string unions (`EnumProperty<"pager" \| "loadMore">`), not as `any`. |
| `npm run lint` | Clean, no output. |
| `npm run build` | `out/controls/CompactList/bundle.js`, **20,907 bytes**. |
| `msbuild /t:build /restore /p:configuration=Release` | **6,872 bytes** packed. `Solution.zip` and `Solution_managed.zip` **9,749 bytes** each. |
| `npm start`, driven in a browser | Rendered. Every property path exercised — see below. |

The two bundle figures are different builds, not one measured twice. `out/` and
both `obj/` directories were deleted before the pack, since the pack is
incremental and will otherwise report success while leaving the development
bundle in place. Confirmed by eye afterwards: the production bundle opens
`/*! For license information …` followed by one minified line, the development
one opens with webpack's "ATTENTION: The eval devtool has been used" banner.

`grep -c 'Reactv16\|FluentUIReactv940\|griffel\|react-dom'` over the production
bundle returns **0**. Nothing framework-shaped is in there, external or bundled,
which is what `framework: "standard"` should mean and is worth checking rather
than assuming.

### In the `pcf-start` harness

Read out of the live DOM and from `getComputedStyle`, not from a screenshot.
The harness supplies three records and three columns of its own.

| Checked | Result |
| --- | --- |
| Markup | `<ul aria-label="All Accounts">` of `<li>`, each a `<button class="CompactList-title">` plus a `<dl>` of `<dt>`/`<dd>` pairs. |
| **No horizontal overflow** | `scrollWidth === clientWidth === 982`. This is the control's entire premise, so it is the one thing worth measuring rather than eyeballing. |
| Detail layout | `display: grid`, `grid-template-columns: 73.25px 888.75px` — label auto-sized, value taking the rest, both on one row. |
| `showLabels: false` | Grid collapses to a single `966px` track, `<dd>` starts at the container's left edge, and the `<dt>` is **still in the DOM** with its text at `position: absolute; width: 1px`. Hidden from the eye, present for a screen reader. |
| `density: compact` | `is-compact` on the `<ul>`, item padding `4px 8px`. |
| `openOnItemClick: false` | Title renders as `<span>`, not `<button>`. |
| `paging: loadMore` | Footer renders `3 of 3 shown` and **no** Load more button, because `hasNextPage` is false. The guard works; the append itself is not reachable here. |

That last row is the limit of what any harness can show — see "Still open".

## The bundle-size finding, which is not what was expected

The premise going in was that a plain-DOM dataset control would be "a fraction"
of the React one. Measured against `pcf-data-table`, the same shape of control
built `react_virtual`:

| | Compact List (standard) | Data Table (react_virtual) |
| --- | --- | --- |
| `npm run build` | 20,907 B | 33,263 B |
| msbuild pack | **6,872 B** | **9,020 B** |
| Solution zip | 9,749 B | 10,330 B |

**2,148 bytes, or 24%.** Not a fraction — a rounding error on any connection
that is going to load a Dataverse form at all.

The reason is that React and Fluent were never *in* Data Table's bundle either.
`react_virtual` makes them `<platform-library>` externals, so both controls ship
only their own code, and the difference measured here is a `<ul>` builder versus
a React tree plus Fluent component usage — real, but small.

What the number does not capture is what the **browser** fetches. Data Table
also causes the host to load the platform's React and Fluent, which Compact List
does not. On a form or app that already has a React control on it those are
cached and cost nothing; on one that does not, they are the actual difference,
and they are far larger than 2 KB.

So the honest form of the advice is: **choosing `standard` over `react_virtual`
is not a bundle-size decision.** It is a decision about whether the control's UI
earns a component library, and about whether this control is the only reason the
platform libraries get pulled in. The skill's `## Bundle size` section currently
implies the first, and it is the weakest of the three arguments.

## What the scaffold got right

Nothing in `_template`'s dataset variant had to be corrected. Specifically, all
of the following compiled and packed on the first attempt, with no cast and no
workaround:

- `dataset.paging` — `setPageSize`, `reset`, `loadNextPage`, `loadPreviousPage`,
  `hasNextPage`, `hasPreviousPage`, `totalResultCount`, `firstPageNumber`.
- `dataset.columns` typed as `PropertyHelper.DataSetApi.Column[]` with `order`,
  `isHidden`, `isPrimary`, `displayName` all present.
- `dataset.records[id]` typed as
  `PropertyHelper.DataSetApi.EntityRecord`, with `getFormattedValue()` and
  `getNamedReference()`. Naming that type explicitly in a helper signature needs
  the full `ComponentFramework.PropertyHelper.DataSetApi.EntityRecord` path —
  there is no shorter alias exported.
- `context.resources.getString()`, `context.mode.isVisible`, `dataset.getTitle()`,
  `dataset.error` / `errorMessage` / `loading` / `sortedRecordIds`.

The `--type dataset` standard path can be treated as working. The one thing it
does *not* do is warn that its scaffolded control is a table: adopting the
template and then building a list means deleting most of `index.ts`, which is
fine, but the shipped file is closer to `pcf-data-table` than a reader of
`TEMPLATE.md` would guess.

**The `demo/**` exclude in the `.pcfproj` does nothing, and the belief that it
matters is wrong.** The zip contains eight files — manifest, bundle, licence,
CSS, resx, and the three solution XMLs — and no fixture. It is tempting to read
that as the `<ExcludeDirectories Include="…\demo\**" />` line working, and this
SPEC said exactly that in its first draft. Two packs settle it:

| Pack | `demo/` in the zip? |
| --- | --- |
| This control, **with** the line | No — 8 files |
| This control, **line deleted** | No — 8 files |
| `pcf-tag-list`, which never had the line | No — 12 files, no `demo/tags.json` |

The solution pack takes `out/controls/<Control>/**` and the solution XMLs. It
never considers loose project files, so there is nothing for the exclude to
exclude. The `<None Include>`/`ExcludeDirectories` pair shapes the msbuild
*project*'s item list, which is not what gets packaged.

The claim originated in `pcf-data-table/SPEC.md` — "confirms the
`<ExcludeDirectories>` line added to `DataTable.pcfproj`" — and it is an
attribution to a cause that was never tested against its absence. The template's
comment on the line ("a fixture packed into the solution is dead weight shipped
to every customer") says the same thing and is also wrong. Both have been
corrected. The line is harmless and kept for uniformity across the repositories,
but it is not load-bearing and a repository missing it is not shipping anything
extra.

## Platform behaviour worth knowing

**Enum properties generate as string unions.** `EnumProperty<"pager" |
"loadMore">`, not `any` and not a bare `string`. That is a genuine improvement
over `of-type-group`, which erases the type when the grouped members share no
generated property type. If a property is a fixed set of author-defined choices,
`Enum` costs nothing at the type level. The control still reads them through
`String(raw ?? default)` rather than relying on the union, so that an unexpected
value from a canvas formula falls back instead of rendering nothing.

**`updateView` fires on every dataset change, including this control's own.**
Inherited from the scaffold and preserved: the page-size guard is on
`this.appliedPageSize`, an instance field, not on `ds.paging.pageSize`, because
the platform's value does not equal the requested one until the refresh lands.

Adding a second mutator made the same point twice. `applyPagingMode()` calls
`paging.reset()` and `refresh()` when the mode changes, and it has to skip that
on the *first* `updateView` — where `appliedPagingMode` is still `''` — or it
fires a refresh on load for no reason, immediately followed by the one
`applyPageSize()` fires. Two guarded mutators in one `updateView` need to know
about each other; a single one does not, which is why the scaffold does not
mention it.

**Rebuilding the container each render destroys focus, and load-more is where
that shows.** The scaffolded dataset control does `container.innerHTML = ''` on
every render, which contradicts the general rule to build DOM in `init` and
mutate it in `updateView`. For a dataset control it is defensible — the record
set changes wholesale — but "Load more" is a button the user presses repeatedly,
and pressing it destroys it. The control sets a flag before calling
`loadNextPage()` and re-focuses the new button after the render. Any dataset
control with a persistent action in its chrome needs the same, and the scaffold
has no such control so it never had to.

**`getFormattedValue()` returning an empty string is the only signal available
for "this record has no value here".** There is no per-cell null on
`EntityRecord`; `getValue()` would give one, but then the control would be
formatting currency and dates itself. Skipping on the empty formatted string is
the right trade for a list and is the behaviour documented in
`docs/limitations.md`, not an accident.

## `loadOnlyNewPage` is ignored, and two other things follow from it

**Observed on a real model-driven form, 2026-08-21.** This is the one section
here that comes from the platform rather than from a build, and it contradicts
what the type definitions say.

The report was a screenshot: a 6-record Accounts view at page size 3, after one
click of **Next**. All six records on screen, one page under the other. The
status read **"4–9 of 6"**. Previous was disabled and stayed disabled.

Three distinct faults, one cause:

1. **`loadNextPage(true)` accumulated.** `sortedRecordIds` came back holding
   pages 1..2. The `loadOnlyNewPage` argument is documented, typed, passed —
   and ignored. Everything written about this call in this repository, in
   `pcf-data-table` and in the template assumed the opposite.
2. **`hasPreviousPage` stayed false on page 2**, so Previous never unlocked and
   there was no way back. That is not a second bug so much as the platform being
   truthful about a different question: it considers the load to be the *range*
   pages 1..2, and a range beginning at page 1 has nothing before it.
3. **`firstPageNumber` reported 2 while the ids held both pages**, and the label
   combined a start taken from the platform with a row count taken from the
   accumulated array. Hence a range running past its own total.

### What the fix does

- **Page number is the control's own counter.** `firstPageNumber` is no longer
  read at all, and Previous is enabled from `this.page > 1` rather than from
  `hasPreviousPage`. `hasNextPage` is kept — it has behaved, and it is the only
  available answer to "is there more".
- **`loadExactPage(n)` when the host has it**, falling back to
  `loadNextPage(true)` / `loadPreviousPage(true)`. It is typed as required, and
  feature-detected anyway: a required member is a claim about the type
  definitions, not about the host, which is the whole lesson of this section.
- **The pager slices `sortedRecordIds` to the current page**, which the general
  rule says never to do. The rule assumes the flag is honoured, and it is not.
  The slice is guarded on `ids.length > pageSize`, so it does nothing on a
  platform that behaves — the repair removes itself rather than needing to be
  removed. It slices by page offset rather than taking the tail, so it is
  correct going backwards too. Load-more mode is untouched: there, accumulation
  is the point.

### How it was checked

Neither harness can page — `pcf-start` and the hub's demo harness both report a
single page — so the control was compiled to CommonJS with `tsc` and driven
under jsdom against a fake dataset reproducing the platform's behaviour: 6
records, page size 3, `loadNextPage` ignoring its argument, `hasPreviousPage`
pinned false, `firstPageNumber` reporting the loaded page count.

Run against the **pre-fix** commit it reproduces the screenshot exactly — six
rows, `"4–9 of 6"`, Previous disabled — and 6 of 13 assertions fail. Against the
fix, 13 of 13 pass. The same driver also runs a dataset that *honours* the flag,
and the fix passes there too, which is the check that matters: it is a repair
for a misbehaving host, not a control that now requires one.

The driver is scratch, not committed. It is worth rebuilding rather than
trusting this paragraph if the paging code changes again.

## Still open

- **The load-more append is still unobserved.** The pager is now settled (see
  above), but nobody has clicked **Load more** on a real view. Bare
  `loadNextPage()` should accumulate — the platform accumulates even when told
  not to, so the mode that *wants* accumulation is the one least likely to be
  broken — but "should" is doing work in that sentence.
- **`loadExactPage` has not been exercised.** The form that produced the bug
  report has not been retested since the fix, so the branch that actually ran
  there is unknown: if `loadExactPage` exists on that host it was used, and if
  it does not the `loadNextPage(true)` + slice path was. Both are covered by the
  driver, neither by the platform.
- **The logo is still the template placeholder.** `media/screenshot.png` is now
  real — an Accounts subgrid on a form, referenced from `docs/overview.md` and
  `docs/model-driven.md` — but `media/logo.png` is the one the template ships.
  Nothing in CI checks either, and `npm run check` validates only the paths
  named in `pcfhub.json`, not the paths in the Markdown.

  **The screenshot is not evidence the pager fix works.** It shows page 1 —
  three of six records, "1–3 of 6", Previous correctly disabled — and page 1
  rendered correctly before the fix too. The jsdom driver's pre-fix run passes
  every page-1 assertion and fails only after Next is clicked. A screenshot that
  would settle it is one of page 2.
- **English only.** `strings/CompactList.1033.resx` is the only resx. The
  sibling controls ship 1031, 1036, 1041 and 3082 as well.
- **Never imported into an environment.** Everything above is a local build and
  a local pack. No form, no canvas app, no real view.
- **`detailColumns` has no upper bound beyond the column count.** A view with 40
  columns and `detailColumns` at 40 will render 40 lines per record. That is the
  maker's call, but there is no virtualisation behind it — see
  `docs/limitations.md`.
