---
title: Canvas apps
description: Adding Compact List to a canvas app or custom page.
order: 3
---

# Using it in a canvas app

:::steps
1. From **Insert → Get more components**, open the **Code** tab and import
   **Compact List**.
2. Place it from **Insert → Code components**.
3. Set **Items** to a table, then choose the fields to show.
4. Bind the properties below.
:::

## Wiring the properties

`Items` is the binding that matters. Everything else has a default.

```powerfx
// Items
Filter(Accounts, 'Status Reason' = 'Status Reason (Accounts)'.Active)
```

| Property | Value |
| --- | --- |
| Items | `Filter(Accounts, …)` |
| Paging | `"loadMore"` |
| Detail lines | `2` |
| Show labels | `false` |
| Density | `"compact"` |

:::callout{type=info}
**The fields you pick are the list.** A canvas app has no view, so the columns
come from the **Fields** flyout on `Items` rather than from a view designer.
Pick the ones you want to see, in the order you want them — the control renders
what it is given. Picking none shows a message saying so rather than an empty
box.
:::

`Paging` and `Density` take the string values above. Typing anything else falls
back to the default rather than erroring.

## Adding a search box

Set **Show search** to `true` and the search properties come into play:

| Property | Value |
| --- | --- |
| Show search | `true` |
| Search columns | `"name, accountnumber"` |
| Match | `"startsWith"` |
| Minimum characters | `2` |
| Typing pause (ms) | `300` |

:::callout{type=info}
Pick the fields in the **Fields** flyout deliberately. With **Search columns**
empty, the control searches every text column *that `Items` supplies* — and in
canvas that is exactly the set you picked there.
:::

The filter is applied through the dataset, so `Items` has to be something the
platform can re-query: a delegable expression over a Dataverse table. A
collection or a materialised table accepts the filter and returns the same rows.

## Reading the outputs

Three. The control writes `OpenedRecordId` — the id of the item whose title was
last clicked — and it writes it **before** it tries to open anything. That
ordering is what makes the control usable here at all: canvas has no form to
navigate to, so `openDatasetItem()` does nothing, and the output is the whole
mechanism.

With search on, `FilteredRecordCount` and `SearchTerm` let the app say "no
results" in its own words:

```powerfx
// A label under the list
If(
    CompactList1.FilteredRecordCount = 0,
    "Nothing matches " & CompactList1.SearchTerm,
    CompactList1.FilteredRecordCount & " results"
)
```

`FilteredRecordCount` is the server's count of what matched, not the number of
rows on the current page. **It is `-1` on a view the platform did not count**,
which is common on large tables — and it travels as `-1` rather than as `0`
precisely so a formula can tell "none" from "unknown":

```powerfx
Switch(
    true,
    CompactList1.FilteredRecordCount < 0, "Showing results",
    CompactList1.FilteredRecordCount = 0, "No results",
    CompactList1.FilteredRecordCount & " results"
)
```

Do the navigation yourself in `OnChange`:

```powerfx
// OnChange
If(
    !IsBlank(CompactList1.OpenedRecordId),
    Navigate(DetailScreen, ScreenTransition.Cover,
        { SelectedAccount: LookUp(Accounts, GUID(CompactList1.OpenedRecordId)) })
)
```

If you do not want the titles to be buttons at all, set **Open on click** to
`false` and the list renders as plain text.

## Two things that differ from a form

- **There are no column widths to honour.** `visualSizeFactor` is a view
  concept; canvas reports nothing for it. It makes no difference to this
  control, which stacks rather than lays out columns — one of the reasons it
  suits canvas better than a table does.
- **Paging depends on the data source.** A delegable `Items` expression pages
  as you would expect. One that Power Apps has already materialised may report
  a single page, in which case neither the pager nor **Load more** has anything
  to do.
