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
     * Every render replaces the container's contents, which throws away focus.
     *
     * That is survivable for a list of records — they change wholesale anyway —
     * except on the one control the user presses repeatedly. Clicking "Load
     * more" triggers a refresh, the refresh re-renders, and the button the
     * finger or the keyboard was on ceases to exist. So note the intent and
     * restore it.
     */
    private restoreFocusToLoadMore = false;

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
        const ids = dataset.sortedRecordIds ?? [];

        if (ids.length === 0) {
            this.message(dataset.loading ? getString('CompactList_Loading') : getString('CompactList_Empty'));
            return;
        }

        this.container.appendChild(this.list(context, dataset, columns, ids, getString));
        this.container.appendChild(this.footer(context, dataset, ids.length, getString));

        if (this.restoreFocusToLoadMore) {
            this.restoreFocusToLoadMore = false;
            this.container.querySelector<HTMLButtonElement>('.CompactList-loadMore')?.focus();
        }
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
                this.restoreFocusToLoadMore = true;
                dataset.paging.loadNextPage();
            });

            wrap.appendChild(button);
        }

        return wrap;
    }

    private pager(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'CompactList-footer CompactList-pager';

        const previous = document.createElement('button');
        previous.type = 'button';
        previous.textContent = getString('CompactList_Previous');
        previous.disabled = !dataset.paging.hasPreviousPage;
        previous.addEventListener('click', () => {
            if (!dataset.paging.hasPreviousPage) {
                return;
            }

            this.page = Math.max(1, this.page - 1);
            dataset.paging.loadPreviousPage(true);
        });

        const status = document.createElement('span');
        status.className = 'CompactList-status';
        status.setAttribute('aria-live', 'polite');
        status.textContent = this.pagerLabel(dataset, rowsOnPage, getString);

        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = getString('CompactList_Next');
        next.disabled = !dataset.paging.hasNextPage;
        next.addEventListener('click', () => {
            if (!dataset.paging.hasNextPage) {
                return;
            }

            this.page += 1;

            // `true` is what makes this a pager. Without it the platform
            // returns the whole page range and the list grows instead of
            // turning — which is the other mode, reached by a property rather
            // than by forgetting an argument.
            dataset.paging.loadNextPage(true);
        });

        wrap.append(previous, status, next);

        return wrap;
    }

    /**
     * `totalResultCount` is -1 when the platform did not count the rows, which
     * is common on large views. Printing "of -1" is the tell that nobody
     * checked, so name the page instead of the range.
     */
    private pagerLabel(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): string {
        const total = dataset.paging.totalResultCount;
        const first = dataset.paging.firstPageNumber;
        const page = typeof first === 'number' && first >= 1 ? first : this.page;

        if (total < 0) {
            return getString('CompactList_PageStatus').replace('{0}', String(page));
        }

        const start = (page - 1) * this.appliedPageSize + 1;

        return getString('CompactList_RangeStatus')
            .replace('{0}', String(start))
            .replace('{1}', String(start + rowsOnPage - 1))
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
