import { IInputs, IOutputs } from './generated/ManifestTypes';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;

/** The platform's ceiling on a page. Not in the type definitions. */
const MAX_PAGE_SIZE = 250;

/** What a record shows when the title column is empty for that row. */
const NO_TITLE = '—';

type PagingMode = 'pager' | 'loadMore';

/**
 * A standard (DOM) dataset control that renders a view as a stacked list.
 *
 * Two things about it are deliberate and easy to undo by accident.
 *
 * **A dataset has mutators, and `updateView` runs on every change including the
 * ones this control caused.** `setPageSize()` does nothing until the next
 * fetch, so it has to be followed by `refresh()` — and `refresh()` fires
 * `updateView`. Every mutator call below is either guarded on a field this
 * class owns or sits in an event handler. That is the single most important
 * property to preserve when editing this file.
 *
 * **The two paging modes are one call with different arguments.**
 * `loadNextPage(true)` turns the page; bare `loadNextPage()` returns the whole
 * page range, so `sortedRecordIds` accumulates and the list grows. A table
 * treats the second as a bug. A list wants it: the record you were reading
 * stays where it was.
 */
export class CompactList implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    private notifyOutputChanged!: () => void;
    private openedRecordId = '';

    /**
     * The page size this control has already asked the platform for.
     *
     * Guarding on this rather than on `ds.paging.pageSize` is the whole trick:
     * the platform's own value will not equal the requested one until the
     * refresh lands, so comparing against it re-fires at least once more — and
     * if the platform clamps the request, it never converges at all.
     */
    private appliedPageSize = 0;

    /** Empty until the first `updateView`, which is what makes the reset below skippable. */
    private appliedPagingMode: PagingMode | '' = '';

    private page = 1;

    /**
     * Which footer button to put focus back on after the next render.
     *
     * Every render replaces the container's contents, which throws away focus.
     * That is survivable for a list of records — they change wholesale anyway —
     * and wrong for the buttons the user presses repeatedly: clicking Next or
     * Load more triggers a refresh, the refresh re-renders, and the button the
     * finger or the keyboard was on ceases to exist.
     */
    private restoreFocus: 'previous' | 'next' | 'loadMore' | null = null;

    public init(
        _context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        this.container = container;
        this.container.classList.add('CompactList');
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        const dataset = context.parameters.records;

        this.applyPagingMode(context, dataset);
        this.applyPageSize(context, dataset);
        this.render(context, dataset);
    }

    /**
     * `null` is not `undefined` here: the generated `IOutputs` types every
     * output as optional, and `undefined` means "no change" — so a cleared
     * value would be unobservable. Emit the empty string instead.
     */
    public getOutputs(): IOutputs {
        return { openedRecordId: this.openedRecordId };
    }

    public destroy(): void {
        // Listeners are attached to elements inside `container`, which the
        // platform removes — but the container itself is reused, so clear it.
        this.container.innerHTML = '';
    }

    // ------------------------------------------------------------- platform

    /**
     * Switching between pager and load-more mid-list has to start over.
     *
     * Going pager → loadMore with three pages already turned would append the
     * fourth onto a list showing only the third; going the other way would page
     * within an accumulated set. Neither is a state worth reasoning about.
     *
     * Skipped on the first `updateView`, when `appliedPagingMode` is still
     * empty: there is nothing to reset, and `applyPageSize` below is about to
     * refresh anyway.
     */
    private applyPagingMode(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const wanted = this.pagingMode(context);

        if (wanted === this.appliedPagingMode) {
            return;
        }

        const first = this.appliedPagingMode === '';

        this.appliedPagingMode = wanted;

        if (first) {
            return;
        }

        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }

    /** Ask for a new page size, but only when it actually changed. See the note above. */
    private applyPageSize(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const raw = context.parameters.pageSize.raw ?? 25;
        const wanted = clamp(raw, 1, MAX_PAGE_SIZE);

        if (wanted === this.appliedPageSize) {
            return;
        }

        this.appliedPageSize = wanted;
        this.page = 1;
        dataset.paging.setPageSize(wanted);
        dataset.refresh();
    }

    private pagingMode(context: ComponentFramework.Context<IInputs>): PagingMode {
        return String(context.parameters.paging.raw ?? 'pager') === 'loadMore' ? 'loadMore' : 'pager';
    }

    // --------------------------------------------------------------- render

    private render(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const getString = (id: string): string => context.resources.getString(id);

        this.container.innerHTML = '';

        // Canvas relies on this; a model-driven form hides the section itself.
        if (!context.mode.isVisible) {
            return;
        }

        if (dataset.error) {
            this.message(dataset.errorMessage || getString('CompactList_Error'), true);
            return;
        }

        // `isHidden` and `order` are the maker's decisions in the view
        // designer. A list that ignores either looks broken to whoever set them.
        const columns = (dataset.columns ?? [])
            .filter((column) => !column.isHidden)
            .sort((a, b) => a.order - b.order);

        // A canvas app supplies only the columns picked in the Items Fields
        // flyout. None picked is a real state, and an empty <ul> reads as a
        // broken control rather than as an unfinished configuration.
        if (columns.length === 0) {
            this.message(
                dataset.loading ? getString('CompactList_Loading') : getString('CompactList_NoColumns'),
            );
            return;
        }

        // `loading` is true on the first updateView, before any records arrive,
        // so rendering the empty state here flashes "No records" on every load.
        const all = dataset.sortedRecordIds ?? [];

        if (all.length === 0) {
            this.message(dataset.loading ? getString('CompactList_Loading') : getString('CompactList_Empty'));
            return;
        }

        const ids = this.pagingMode(context) === 'loadMore' ? all : this.currentPage(all);

        this.container.appendChild(this.list(context, dataset, columns, ids, getString));
        this.container.appendChild(this.footer(context, dataset, ids.length, getString));

        // The button that caused this render no longer exists. Put focus on its
        // replacement, and when that replacement is disabled — the last page,
        // or the end of a load-more list — fall back to the pager's other
        // button rather than stranding the keyboard at <body>.
        if (this.restoreFocus) {
            const wanted = this.restoreFocus;
            this.restoreFocus = null;

            const button = this.container.querySelector<HTMLButtonElement>(`.CompactList-${wanted}`);
            const fallback =
                wanted === 'next'
                    ? this.container.querySelector<HTMLButtonElement>('.CompactList-previous')
                    : wanted === 'previous'
                      ? this.container.querySelector<HTMLButtonElement>('.CompactList-next')
                      : null;

            (button && !button.disabled ? button : fallback)?.focus();
        }
    }

    /**
     * The records belonging to the page the pager says it is on.
     *
     * **This is the one place the control slices `sortedRecordIds`, and the
     * general rule is never to do it.** On a platform that honours
     * `loadOnlyNewPage`, that array already *is* the current page, and slicing
     * it hides records the platform paged for.
     *
     * Observed on a real model-driven form, 2026-08-21: it does not honour it.
     * `loadNextPage(true)` from page 1 of a 6-record view at page size 3 came
     * back with all six ids, so the second page rendered under the first. The
     * flag is documented, typed and ignored. `pcf-data-table` and the template
     * carry the same call and the same assumption.
     *
     * So the slice is a repair for one specific platform behaviour, and it is
     * written to disappear the moment that behaviour changes: when the array is
     * no longer than a page it is already the page, and nothing is cut.
     *
     * Slicing by page index rather than taking the tail is what makes it work
     * going backwards as well as forwards — the accumulated array is pages
     * 1..N in order, so page 2 is at offset `pageSize`, whichever page was
     * asked for last.
     */
    private currentPage(ids: string[]): string[] {
        if (ids.length <= this.appliedPageSize) {
            return ids;
        }

        const start = (this.page - 1) * this.appliedPageSize;
        const slice = ids.slice(start, start + this.appliedPageSize);

        // A platform that accumulates differently — or a page counter that has
        // drifted — must not empty the list. Showing the wrong page is
        // recoverable by clicking; showing nothing looks like data loss.
        return slice.length > 0 ? slice : ids.slice(-this.appliedPageSize);
    }

    private message(text: string, isError = false): void {
        const p = document.createElement('p');
        p.className = isError ? 'CompactList-message CompactList-error' : 'CompactList-message';
        p.textContent = text;
        this.container.appendChild(p);
    }

    private list(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        columns: Column[],
        ids: string[],
        getString: (id: string) => string,
    ): HTMLElement {
        const title = this.titleColumn(context, columns);
        const details = this.detailColumns(context, columns, title);
        const showLabels = context.parameters.showLabels.raw !== false;
        const openOnClick = context.parameters.openOnItemClick.raw !== false;
        const compact = String(context.parameters.density.raw ?? 'comfortable') === 'compact';

        const list = document.createElement('ul');
        list.className = compact ? 'CompactList-items is-compact' : 'CompactList-items';

        // The view's name, so a screen reader can tell one list on a form from
        // another. A <ul> takes an accessible name directly; there is no
        // <caption> to hide the way a table has.
        list.setAttribute('aria-label', dataset.getTitle());

        if (dataset.loading) {
            list.classList.add('is-loading');
        }

        for (const id of ids) {
            const record = dataset.records[id];

            if (!record) {
                continue;
            }

            const item = document.createElement('li');
            item.className = 'CompactList-item';

            const heading = record.getFormattedValue(title.name) || NO_TITLE;

            if (openOnClick) {
                // A real <button>, so opening is reachable by keyboard. A click
                // handler on the <li> is not.
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'CompactList-title';
                button.textContent = heading;
                button.title = getString('CompactList_OpenRecord').replace('{0}', heading);
                button.addEventListener('click', () => this.openRecord(dataset, id));
                item.appendChild(button);
            } else {
                const span = document.createElement('span');
                span.className = 'CompactList-title';
                span.textContent = heading;
                item.appendChild(span);
            }

            const pairs = this.details(record, details, showLabels);

            if (pairs) {
                item.appendChild(pairs);
            }

            list.appendChild(item);
        }

        return list;
    }

    /**
     * The detail lines, as a <dl>.
     *
     * Empty values are skipped rather than rendered blank. A table has to keep
     * the cell — the column is still there — but a list has no grid to hold
     * open, and a run of empty lines is the difference between this control and
     * a table with the headers turned off.
     *
     * `showLabels` hides the <dt> **visually**, in CSS, rather than omitting it.
     * A <dl> of bare <dd> elements is malformed, and a screen reader reading
     * four unlabelled values in a row has no idea what any of them are.
     */
    private details(
        record: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
        columns: Column[],
        showLabels: boolean,
    ): HTMLElement | null {
        if (columns.length === 0) {
            return null;
        }

        const dl = document.createElement('dl');
        dl.className = showLabels ? 'CompactList-details' : 'CompactList-details is-labelless';
        let rendered = 0;

        for (const column of columns) {
            // `getFormattedValue` takes the column's *name*. With property-set
            // roles the column is found by `alias` and read by `name`, and
            // getting that backwards renders zero values against real data
            // while looking fine in a demo fixture.
            const value = record.getFormattedValue(column.name);

            if (!value) {
                continue;
            }

            const dt = document.createElement('dt');
            dt.className = 'CompactList-label';
            dt.textContent = column.displayName;

            const dd = document.createElement('dd');
            dd.className = 'CompactList-value';
            dd.textContent = value;

            dl.append(dt, dd);
            rendered += 1;
        }

        return rendered > 0 ? dl : null;
    }

    /**
     * Which column is the title line.
     *
     * `titleColumn` is a plain input rather than a property-set role, so the
     * maker types a logical name and can get it wrong. A name that matches
     * nothing falls back rather than rendering a list of dashes — the fallback
     * is `isPrimary`, which is the view's own answer to the same question.
     */
    private titleColumn(context: ComponentFramework.Context<IInputs>, columns: Column[]): Column {
        const named = (context.parameters.titleColumn.raw ?? '').trim();
        const chosen = named ? columns.find((column) => column.name === named) : undefined;

        return chosen ?? columns.find((column) => column.isPrimary) ?? columns[0];
    }

    /** The columns beneath the title, in the view's order, capped by `detailColumns`. */
    private detailColumns(
        context: ComponentFramework.Context<IInputs>,
        columns: Column[],
        title: Column,
    ): Column[] {
        const wanted = clamp(context.parameters.detailColumns.raw ?? 3, 0, columns.length);

        return columns.filter((column) => column.name !== title.name).slice(0, wanted);
    }

    // --------------------------------------------------------------- paging

    private footer(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        shownOnPage: number,
        getString: (id: string) => string,
    ): HTMLElement {
        return this.pagingMode(context) === 'loadMore'
            ? this.loadMore(dataset, shownOnPage, getString)
            : this.pager(dataset, shownOnPage, getString);
    }

    /**
     * Append, rather than turn.
     *
     * `loadNextPage()` with no argument is documented as returning results for
     * the whole page range, so `sortedRecordIds` comes back holding pages 1..N
     * and the next render simply has more items in it. There is no accumulator
     * to keep here, and deliberately so — a local copy of the records would be
     * a second source of truth that a sort or a refresh silently invalidates.
     */
    private loadMore(dataset: DataSet, shown: number, getString: (id: string) => string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'CompactList-footer';

        const total = dataset.paging.totalResultCount;

        const status = document.createElement('span');
        status.className = 'CompactList-status';
        status.setAttribute('aria-live', 'polite');
        status.textContent =
            total < 0
                ? getString('CompactList_LoadedStatusUnknown').replace('{0}', String(shown))
                : getString('CompactList_LoadedStatus')
                      .replace('{0}', String(shown))
                      .replace('{1}', String(total));

        wrap.appendChild(status);

        if (dataset.paging.hasNextPage) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'CompactList-loadMore';
            button.textContent = getString('CompactList_LoadMore');
            button.disabled = dataset.loading;
            button.addEventListener('click', () => {
                if (!dataset.paging.hasNextPage) {
                    return;
                }

                // The re-render this causes destroys this very button.
                this.restoreFocus = 'loadMore';
                dataset.paging.loadNextPage();
            });

            wrap.appendChild(button);
        }

        return wrap;
    }

    private pager(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'CompactList-footer CompactList-pager';

        /*
         * `hasPreviousPage` is **not** the question "is there a page before
         * this one".
         *
         * Observed on a real form: after paging forward to page 2 it was still
         * false, and Previous stayed disabled with no way back. That is
         * consistent with the platform treating the load as the *range* pages
         * 1..2 rather than as page 2 — the range does begin at page 1, so by
         * its own reckoning there is nothing before it, and the answer is
         * truthful to a question this pager is not asking.
         *
         * The control's own counter is the one thing that does answer it.
         */
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = 'CompactList-previous';
        previous.textContent = getString('CompactList_Previous');
        previous.disabled = this.page <= 1;
        previous.addEventListener('click', () => {
            if (this.page <= 1) {
                return;
            }

            this.goToPage(dataset, this.page - 1);
        });

        const status = document.createElement('span');
        status.className = 'CompactList-status';
        status.setAttribute('aria-live', 'polite');
        status.textContent = this.pagerLabel(dataset, rowsOnPage, getString);

        // `hasNextPage` has behaved, so it is still the guard for going
        // forward. It is also the only signal for "is there more", which a
        // local counter cannot supply.
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'CompactList-next';
        next.textContent = getString('CompactList_Next');
        next.disabled = !dataset.paging.hasNextPage;
        next.addEventListener('click', () => {
            if (!dataset.paging.hasNextPage) {
                return;
            }

            this.goToPage(dataset, this.page + 1);
        });

        wrap.append(previous, status, next);

        return wrap;
    }

    /**
     * Turn to an absolute page.
     *
     * `loadExactPage` is preferred because it says what this pager means, and
     * because it is the documented fallback for a platform that ignores
     * `loadOnlyNewPage` — which this one does. It is typed as required rather
     * than optional, but it is still feature-detected: a required member of an
     * interface is a claim about the type definitions, not about the host, and
     * this whole method exists because one of those claims turned out to be
     * worth less than it looked.
     *
     * Either way `currentPage()` decides what is rendered, so the pager turns
     * whether or not the call underneath it honours the request.
     */
    private goToPage(dataset: DataSet, target: number): void {
        const back = target < this.page;

        this.page = Math.max(1, target);
        this.restoreFocus = back ? 'previous' : 'next';

        const paging = dataset.paging;

        if (typeof paging.loadExactPage === 'function') {
            paging.loadExactPage(this.page);
            return;
        }

        if (back) {
            paging.loadPreviousPage(true);
        } else {
            paging.loadNextPage(true);
        }
    }

    /**
     * `totalResultCount` is -1 when the platform did not count the rows, which
     * is common on large views. Printing "of -1" is the tell that nobody
     * checked, so name the page instead of the range.
     *
     * The page number is the control's own counter. `firstPageNumber` used to
     * be preferred over it and produced **"4–9 of 6"** on a real form: it
     * reported 2 while `sortedRecordIds` held both pages, so a start taken from
     * the platform was combined with a row count taken from an accumulated
     * array, and the range ran past its own total. Two sources, one sentence.
     *
     * `rowsOnPage` is now the length of what was actually rendered, so the two
     * halves cannot disagree again.
     */
    private pagerLabel(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): string {
        const total = dataset.paging.totalResultCount;

        if (total < 0) {
            return getString('CompactList_PageStatus').replace('{0}', String(this.page));
        }

        const start = (this.page - 1) * this.appliedPageSize + 1;

        // A page counter that has run past the end — a view that shrank under
        // the control, a refresh that reset the platform's paging but not
        // this — would otherwise print a range beyond the total.
        const end = Math.min(start + rowsOnPage - 1, total);

        return getString('CompactList_RangeStatus')
            .replace('{0}', String(Math.min(start, total)))
            .replace('{1}', String(end))
            .replace('{2}', String(total));
    }

    /**
     * Notify before opening, so the output is observable even on a host where
     * `openDatasetItem` does nothing — which is the canvas case.
     *
     * It takes an EntityReference, and `getNamedReference()` is the only way to
     * build one; there is no id-based overload.
     */
    private openRecord(dataset: DataSet, id: string): void {
        const record = dataset.records[id];

        if (!record) {
            return;
        }

        this.openedRecordId = id;
        this.notifyOutputChanged();
        dataset.openDatasetItem(record.getNamedReference());
    }
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(Math.trunc(value), low), high);
}
