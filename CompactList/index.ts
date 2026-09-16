import { IInputs, IOutputs } from './generated/ManifestTypes';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type FilterExpression = ComponentFramework.PropertyHelper.DataSetApi.FilterExpression;

/** The platform's ceiling on a page. Not in the type definitions. */
const MAX_PAGE_SIZE = 250;

/** What a record shows when the title column is empty for that row. */
const NO_TITLE = '—';

type PagingMode = 'pager' | 'loadMore';

/**
 * `FilterOperator`, which combines the conditions of one expression: 0 And,
 * 1 Or.
 *
 * **The default is And**, and that is the trap: an expression that omits
 * `filterOperator` asks for a term present in *every* named column at once,
 * which matches nothing and reads as a broken query rather than a missing
 * field. Every search across several columns is an Or.
 */
const OR = 1;

/**
 * `ConditionOperator.Like` — 6.
 *
 * Out of roughly ninety operators, `Like` is the one a text search wants and it
 * is supported on both hosts. Several neighbours are not, and the asymmetry
 * runs both ways: `NotLike` (7) and `NotNull` (13) are canvas-only, while
 * `Yesterday` (14), `Today` (15) and `Tomorrow` (16) are model-driven-only.
 * Reaching past this constant is choosing a host, and `docs/limitations.md`
 * carries the table.
 */
const LIKE = 6;

/**
 * The column types a `Like` condition can be built over.
 *
 * A `Like` against a whole number or a lookup is a query the server rejects,
 * and the rejection names the column rather than the control — so the wrong
 * column is chosen here, once, rather than diagnosed later.
 */
const SEARCHABLE = [
    'SingleLine.Text',
    'SingleLine.TextArea',
    'SingleLine.Email',
    'SingleLine.Phone',
    'SingleLine.URL',
    'SingleLine.Ticker',
    'Multiple',
];

/** A Dataverse logical name, and the boundary maker-typed text stops at. */
const LOGICAL_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * A standard (DOM) dataset control that renders a view as a stacked list, with
 * an optional search box that filters the view server-side.
 *
 * Four things about it are deliberate and easy to undo by accident.
 *
 * **A dataset has mutators, and `updateView` runs on every change including the
 * ones this control caused.** `setPageSize()` does nothing until the next
 * fetch, so it has to be followed by `refresh()` — and `refresh()` fires
 * `updateView`. Every mutator call below is either guarded on a field this
 * class owns or sits in an event handler. That is the single most important
 * property to preserve when editing this file. Three mutators share one
 * `updateView` here — paging mode, page size, and the filter — and each has to
 * skip its own first run, or the control refreshes three times on load.
 *
 * **The two paging modes are one call with different arguments.**
 * `loadNextPage(true)` turns the page; bare `loadNextPage()` returns the whole
 * page range, so `sortedRecordIds` accumulates and the list grows. A table
 * treats the second as a bug. A list wants it: the record you were reading
 * stays where it was.
 *
 * **The filter is three calls in one order**, and each is a bug somebody ships:
 *
 *  1. `setFilter` is not a fetch. It records an expression and nothing moves
 *     until `refresh()`. A control that omits the refresh looks exactly like
 *     one whose filter matched nothing.
 *  2. Filtering does not reset the page. Filter from page three and the
 *     control asks for page three of a result set that may have one page in it,
 *     and the platform hands back nothing at all. `paging.reset()` first.
 *  3. `refresh()` fires `updateView`. So the filter is applied from the
 *     debounce handler and never from a render, and it is guarded on the
 *     expression it last applied. Without that guard this is an unbounded
 *     refresh loop, which a browser shows as a hang.
 *
 * **The search bar is built once and the list is rebuilt.** Rebuilding the
 * whole container on every render is fine for records and fatal for a text
 * input: the box the user is typing in would cease to exist on the first
 * keystroke's refresh. So the bar is built in `init` and only `body` below it
 * is cleared per render.
 */
export class CompactList implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    /** Built once and never rebuilt — see the note above. */
    private bar!: HTMLDivElement;
    /** The filled surface the magnifier and the input share. */
    private field!: HTMLDivElement;
    private search!: HTMLInputElement;
    private clear!: HTMLButtonElement;
    /** Rebuilt on every render. */
    private body!: HTMLDivElement;

    private notifyOutputChanged!: () => void;

    /**
     * The most recent context, kept so the debounce handler can reach the
     * dataset a turn after the render that scheduled it.
     */
    private context!: ComponentFramework.Context<IInputs>;

    private openedRecordId = '';
    private term = '';
    private filteredRecordCount = -1;

    /**
     * The expression last handed to the platform, serialised.
     *
     * Compared rather than rebuilt: this is what stops a re-applied identical
     * filter from refreshing.
     *
     * **It starts at `'none'` rather than at `''`, and that is the initial
     * state rather than a sentinel** — a view arrives unfiltered, so "no
     * filter" is what the platform is already doing. Starting from `''` made
     * the first keystroke of every session clear a filter nobody had set:
     * `clearFilter`, `paging.reset` and a `refresh` round trip, before the user
     * had typed enough to search for anything.
     */
    private appliedFilter = 'none';

    /** The pending debounce, which `destroy()` owes a `clearTimeout`. */
    private typing: number | null = null;

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

    /**
     * Whether the search bar was shown at the last `updateView`. `null` until
     * then, for the same reason `appliedPagingMode` starts empty: the first
     * run has nothing to undo.
     */
    private appliedShowSearch: boolean | null = null;

    private page = 1;

    /**
     * Which footer button to put focus back on after the next render.
     *
     * Every render replaces the body's contents, which throws away focus. That
     * is survivable for a list of records — they change wholesale anyway — and
     * wrong for the buttons the user presses repeatedly: clicking Next or Load
     * more triggers a refresh, the refresh re-renders, and the button the
     * finger or the keyboard was on ceases to exist. The search box needs none
     * of this, because it is never rebuilt.
     */
    private restoreFocus: 'previous' | 'next' | 'loadMore' | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        this.context = context;
        this.container = container;
        this.container.classList.add('CompactList');

        this.search = document.createElement('input');
        this.search.className = 'CompactList-search';
        // `search` rather than `text`: it is the right semantics, and on iOS it
        // is also what puts a Search key on the keyboard instead of Return.
        this.search.type = 'search';
        this.search.addEventListener('input', this.onInput);
        this.search.addEventListener('keydown', this.onKeyDown);

        /*
         * The input sits inside a surface rather than being the surface.
         *
         * That is what lets the magnifier sit *in* the field the way Fluent's
         * `contentBefore` does, rather than beside it: the wrapper carries the
         * fill, the border and the focus ring, and the input is a hole in it.
         * A `position: absolute` icon over a padded input is the other way to
         * do this, and it overlaps the text at narrow widths.
         *
         * Flex order also means right-to-left needs no code — the container's
         * `dir` flips the magnifier to the other end on its own.
         */
        this.field = document.createElement('div');
        this.field.className = 'CompactList-field';
        this.field.append(icon('CompactList-searchIcon', SEARCH_PATHS), this.search);

        this.clear = document.createElement('button');
        this.clear.className = 'CompactList-clear';
        this.clear.type = 'button';
        /*
         * Icon-only, so its accessible name comes from `aria-label` rather than
         * from text — set in `paintBar` from the .resx. `title` carries it to a
         * sighted user on hover, which is the half an icon-only button
         * otherwise loses.
         */
        this.clear.append(icon('CompactList-clearIcon', CLEAR_PATHS));
        this.clear.addEventListener('click', this.onClear);

        this.bar = document.createElement('div');
        this.bar.className = 'CompactList-bar';
        // Hidden until `paintBar` reads `showSearch`. Off is the default, so a
        // form that never asked for a search box must never flash one.
        this.bar.hidden = true;
        this.bar.append(this.field, this.clear);

        this.body = document.createElement('div');
        this.body.className = 'CompactList-body';

        this.container.append(this.bar, this.body);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        const dataset = context.parameters.records;

        this.context = context;

        this.applyTheme(context);
        this.applyPagingMode(context, dataset);
        this.applyPageSize(context, dataset);
        this.applyShowSearch(context);
        this.render(context, dataset);
        this.reportCount(dataset);
    }

    /**
     * `null` is not `undefined` here: the generated `IOutputs` types every
     * output as optional, and `undefined` means "no change" — so a cleared
     * value would be unobservable. Emit the empty string instead.
     */
    public getOutputs(): IOutputs {
        return {
            openedRecordId: this.openedRecordId,
            filteredRecordCount: this.filteredRecordCount,
            searchTerm: this.term,
        };
    }

    public destroy(): void {
        this.search.removeEventListener('input', this.onInput);
        this.search.removeEventListener('keydown', this.onKeyDown);
        this.clear.removeEventListener('click', this.onClear);

        /*
         * The debounce, which is the only timer this control takes and the one
         * thing here that outlives the DOM. Left running it fires against a
         * dataset the platform has already released — and on a form the user is
         * navigating between records, that is every navigation.
         */
        if (this.typing !== null) {
            window.clearTimeout(this.typing);
            this.typing = null;
        }

        // Listeners on list items are attached to elements inside `body`,
        // which goes with the container — but the container itself is reused,
        // so clear it.
        this.container.innerHTML = '';
    }

    // ------------------------------------------------------------- platform

    /**
     * Picks which set of colour fallbacks the stylesheet uses.
     *
     * Only the fallbacks. The stylesheet reads Fluent's design tokens through
     * `var()`, and a model-driven form already mounts a `FluentProvider` above
     * every code component on the page — so where the host publishes them this
     * changes nothing at all. It matters on the hosts that publish nothing: a
     * canvas app, or PCFHub's demo harness.
     *
     * `@media (prefers-color-scheme: dark)` is the obvious hook and it is the
     * wrong question: a model-driven app carries its own theme and the user's
     * OS setting says nothing about it. Absent means absent.
     */
    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const isDarkTheme = context.fluentDesignLanguage?.isDarkTheme;

        if (isDarkTheme === undefined) {
            return;
        }

        this.container.classList.toggle('CompactList--dark', isDarkTheme);
    }

    /**
     * Switching between pager and load-more mid-list has to start over.
     *
     * Going pager → loadMore with three pages already turned would append the
     * fourth onto a list showing only the third; going the other way would page
     * within an accumulated set. Neither is a state worth reasoning about.
     *
     * Skipped on the first `updateView`, when `appliedPagingMode` is still
     * empty: there is nothing to reset, and `applyPageSize` below may be about
     * to refresh anyway.
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
        const raw = context.parameters.pageSize.raw;

        /*
         * **The platform already has a page size, and it is usually the right
         * one.** `paging.pageSize` is the size the host is actually retrieving
         * with — a main grid's *Rows per page* personalisation, a subgrid's
         * form-designer setting, the canvas default.
         *
         * So the property carries no `default-value`, and this is the half of
         * that decision written in code: unset, adopt what the host is doing and
         * **never call `setPageSize` at all**; set, override. Adopting still
         * records the number, because the page slice and the pager label both
         * need to know how big a page is — reading it is not the same as asking
         * for it. See the manifest for why the default was removed.
         */
        if (raw === null || raw === undefined) {
            // `0` is "the host did not say", not "one row per page". A fallback
            // of `1` is a page size the platform never has, and the slice would
            // cut the view down to it — twenty rows arriving and one drawn.
            this.appliedPageSize = dataset.paging.pageSize > 0 ? dataset.paging.pageSize : 0;

            return;
        }

        const wanted = clamp(raw, 1, MAX_PAGE_SIZE);

        if (wanted === this.appliedPageSize) {
            return;
        }

        const previous = this.appliedPageSize;

        this.appliedPageSize = wanted;
        dataset.paging.setPageSize(wanted);

        /*
         * **Repaginating makes "page 4" mean something else**, so the reader
         * goes back to the first page — the same move a sort or a filter makes,
         * and for the same reason. Any change to the shape of the result set
         * resets the page.
         *
         * **Only when it changed, though.** `previous` is 0 until a size has
         * been applied, and at mount the platform is already on page one, so
         * resetting there is a round trip bought for nothing: `reset()` is a
         * fetch in its own right and the `refresh()` below is a second one.
         *
         * Close to unfalsifiable while the size comes only from a manifest
         * property — it changes once, at configuration time, almost always on
         * page one. `pcf-data-table` 0.2.0 made it reachable with a
         * rows-per-page picker, and asked for page 3 of a result set that had
         * just been recut.
         */
        if (previous > 0) {
            this.page = 1;
            dataset.paging.reset();
        }

        dataset.refresh();
    }

    /**
     * Turning the search bar off while a filter is in force has to restore the
     * view, or the list stays narrowed with no box left to widen it.
     *
     * The clear runs through `applyFilter`, which is guarded on the expression
     * it last applied — so a bar turned off with nothing typed costs nothing,
     * and the first `updateView` (where `appliedShowSearch` is still `null`)
     * costs nothing either.
     */
    private applyShowSearch(context: ComponentFramework.Context<IInputs>): void {
        const wanted = this.showSearch(context);

        if (wanted === this.appliedShowSearch) {
            return;
        }

        const first = this.appliedShowSearch === null;

        this.appliedShowSearch = wanted;

        if (first || wanted) {
            return;
        }

        this.term = '';
        this.search.value = '';

        if (this.typing !== null) {
            window.clearTimeout(this.typing);
            this.typing = null;
        }

        this.applyFilter(context);
    }

    private pagingMode(context: ComponentFramework.Context<IInputs>): PagingMode {
        return String(context.parameters.paging.raw ?? 'pager') === 'loadMore' ? 'loadMore' : 'pager';
    }

    /** Off unless the maker turned it on: a `TwoOptions` can default to false, and this one does. */
    private showSearch(context: ComponentFramework.Context<IInputs>): boolean {
        return context.parameters.showSearch.raw === true;
    }

    // ------------------------------------------------------------ filtering

    private onInput = (): void => {
        if (!this.showSearch(this.context)) {
            return;
        }

        this.term = this.search.value;

        // The term is an output in its own right, so a canvas app can title its
        // own "no results" message. Reported on every keystroke rather than on
        // the debounce: it costs nothing and it is what the user typed, not
        // what was queried.
        this.notifyOutputChanged();
        this.paintBar(this.context);

        if (this.typing !== null) {
            window.clearTimeout(this.typing);
        }

        const wait = Math.max(0, Math.trunc(this.context.parameters.debounceMs.raw ?? 300));

        this.typing = window.setTimeout(() => {
            this.typing = null;
            this.applyFilter(this.context);
        }, wait);
    };

    /** Escape clears, which is what a `type="search"` box is expected to do. */
    private onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.term !== '') {
            event.stopPropagation();
            this.onClear();
        }
    };

    private onClear = (): void => {
        if (!this.showSearch(this.context)) {
            return;
        }

        this.term = '';
        this.search.value = '';

        if (this.typing !== null) {
            window.clearTimeout(this.typing);
            this.typing = null;
        }

        this.notifyOutputChanged();
        this.paintBar(this.context);
        this.search.focus();
        this.applyFilter(this.context);
    };

    /**
     * Set the filter, reset the page, ask for the data. In that order.
     *
     * Called from the debounce, from Clear and from the search bar being
     * turned off — never from a render, because `refresh()` causes one.
     *
     * In load-more mode the reset is also what collapses the accumulated list:
     * pages 1..N of the unfiltered view are not a prefix of the filtered one,
     * so the platform starts the range over and the list shrinks to page one
     * of what matched.
     */
    private applyFilter(context: ComponentFramework.Context<IInputs>): void {
        const dataset = context.parameters.records;
        const filtering = dataset.filtering;

        /*
         * Typed as always present. That is a claim about the type definitions
         * rather than about the host, and the whole search runs through it —
         * so it is checked rather than trusted. With no filtering there is
         * nothing to express a search through, and the bar says so rather than
         * accepting keystrokes that do nothing.
         */
        if (!filtering) {
            return;
        }

        const expression = this.buildExpression(context, dataset);
        const signature = expression === null ? 'none' : JSON.stringify(expression);

        /*
         * **The guard that keeps this from being an infinite loop.**
         *
         * Every path below ends in `refresh()`, and `refresh()` ends in
         * `updateView`. Re-applying an expression the platform is already
         * filtering by would refresh again, and again. `'none'` is the state
         * before anything has been applied, which is why clearing a filter that
         * was never set does not refresh either.
         */
        if (signature === this.appliedFilter) {
            return;
        }

        this.appliedFilter = signature;

        if (expression === null) {
            filtering.clearFilter();
        } else {
            filtering.setFilter(expression);
        }

        // "Page 4" is meaningless against a different result set, and asking
        // for it returns nothing rather than the first page.
        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }

    /**
     * The expression for what is typed, or `null` to filter nothing.
     *
     * One `Like` condition per searchable column, combined with `Or`. The
     * wildcard placement is the whole of the difference between the two match
     * modes — the server is doing the work either way, and `contains` is the
     * one that cannot use an index.
     */
    private buildExpression(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
    ): FilterExpression | null {
        const term = this.term.trim();
        const minimum = Math.max(1, Math.trunc(context.parameters.minimumCharacters.raw ?? 2));

        if (term.length < minimum) {
            return null;
        }

        const columns = this.searchColumns(context, dataset);

        if (columns.length === 0) {
            return null;
        }

        const escaped = escapeLike(term);
        const value = context.parameters.matchMode.raw === 'contains' ? `%${escaped}%` : `${escaped}%`;

        return {
            filterOperator: OR,
            conditions: columns.map((name) => ({
                attributeName: name,
                conditionOperator: LIKE,
                value,
            })),
        } as FilterExpression;
    }

    /**
     * Which columns to search: the maker's list, or every text column in view.
     *
     * The maker's list is validated against what can be a logical name and the
     * rest is dropped — a typed string is where free text stops being data and
     * starts being part of a query. A name that is merely *wrong* is passed
     * through on purpose: the server's rejection is the only thing that will
     * ever name it, and swallowing that leaves a maker with a search box that
     * does nothing and no way to find out why.
     */
    private searchColumns(context: ComponentFramework.Context<IInputs>, dataset: DataSet): string[] {
        const declared = (context.parameters.searchColumns.raw ?? '')
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter((name) => LOGICAL_NAME.test(name));

        if (declared.length > 0) {
            return declared;
        }

        // Hidden columns are left out: a match the user cannot see is a result
        // they cannot account for.
        return (dataset.columns ?? [])
            .filter((column) => !column.isHidden && SEARCHABLE.includes(column.dataType))
            .map((column) => column.name);
    }

    /**
     * Tell the host how many records the filter matched.
     *
     * Straight from `totalResultCount`, which follows the filter — a control
     * that reported the length of the page would report the page size on every
     * view with more than one page. `-1` travels as `-1` rather than as `0`,
     * because "none" and "the platform did not count" are different answers.
     *
     * Guarded on the value changing, because this runs inside `updateView` and
     * `notifyOutputChanged` brings the platform back through it.
     */
    private reportCount(dataset: DataSet): void {
        const total = dataset.loading ? this.filteredRecordCount : dataset.paging.totalResultCount;

        if (total === this.filteredRecordCount) {
            return;
        }

        this.filteredRecordCount = total;
        this.notifyOutputChanged();
    }

    // --------------------------------------------------------------- render

    private render(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const getString = (id: string): string => context.resources.getString(id);

        this.body.innerHTML = '';

        // Canvas relies on this; a model-driven form hides the section itself.
        // A class rather than an early return, so the bar goes with the list.
        this.container.classList.toggle('CompactList--hidden', !context.mode.isVisible);

        if (!context.mode.isVisible) {
            return;
        }

        this.paintBar(context);

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
            if (dataset.loading) {
                this.message(getString('CompactList_Loading'));
            } else if (this.appliedFilter !== 'none') {
                // "No records" and "nothing matched your search" are different
                // sentences, and showing the first after a search reads as an
                // empty view rather than as a search that found nothing.
                this.message(getString('CompactList_NoMatches').replace('{0}', this.term.trim()));
            } else {
                this.message(getString('CompactList_Empty'));
            }

            return;
        }

        const ids = this.pagingMode(context) === 'loadMore' ? all : this.currentPage(all);

        this.body.appendChild(this.list(context, dataset, columns, ids, getString));
        this.body.appendChild(this.footer(context, dataset, ids.length, getString));

        // The button that caused this render no longer exists. Put focus on its
        // replacement, and when that replacement is disabled — the last page,
        // or the end of a load-more list — fall back to the pager's other
        // button rather than stranding the keyboard at <body>.
        if (this.restoreFocus) {
            const wanted = this.restoreFocus;
            this.restoreFocus = null;

            const button = this.body.querySelector<HTMLButtonElement>(`.CompactList-${wanted}`);
            const fallback =
                wanted === 'next'
                    ? this.body.querySelector<HTMLButtonElement>('.CompactList-previous')
                    : wanted === 'previous'
                      ? this.body.querySelector<HTMLButtonElement>('.CompactList-next')
                      : null;

            (button && !button.disabled ? button : fallback)?.focus();
        }
    }

    /**
     * The persistent bar, updated in place.
     *
     * Everything here is assigned rather than rebuilt, because the input is the
     * one element in this control that a user can be in the middle of using.
     * Note that its `value` is not assigned at all after `init`: writing it
     * while somebody is typing moves the caret to the end on every keystroke,
     * and there is no incoming value to reconcile it with — the term belongs to
     * this control rather than to the platform.
     */
    private paintBar(context: ComponentFramework.Context<IInputs>): void {
        this.bar.hidden = !this.showSearch(context);

        if (this.bar.hidden) {
            return;
        }

        const getString = (id: string): string => context.resources.getString(id);
        const minimum = Math.max(1, Math.trunc(context.parameters.minimumCharacters.raw ?? 2));
        const dataset = context.parameters.records;
        const searchable =
            Boolean(dataset.filtering) && this.searchColumns(context, dataset).length > 0;

        this.search.setAttribute('aria-label', context.mode.label || getString('CompactList_Search'));
        this.search.placeholder = searchable
            ? getString('CompactList_SearchHint').replace('{0}', String(minimum))
            : getString('CompactList_Unfilterable');

        /*
         * A view with nothing to search is a real state, and it has two causes
         * that look identical from here: no text column in the view, and a host
         * that supplies no `filtering` at all. Both mean the same thing to
         * whoever is looking at it, so they get the same sentence and the box
         * stops accepting keystrokes that could not do anything.
         */
        this.search.disabled = !searchable || context.mode.isControlDisabled;

        /*
         * The surface carries the disabled look, not the input inside it, so it
         * needs telling. A class rather than `:has(:disabled)` — that selector
         * is fine on a current Chromium and this is one less thing to be true
         * about whatever a customer is running.
         */
        this.field.classList.toggle('CompactList-field--disabled', this.search.disabled);

        this.clear.setAttribute('aria-label', getString('CompactList_Clear'));
        this.clear.title = getString('CompactList_Clear');
        this.clear.hidden = this.term === '';
        this.clear.disabled = this.search.disabled;

        this.container.dir = context.userSettings.isRTL ? 'rtl' : 'ltr';
        this.container.classList.toggle('CompactList--searching', this.typing !== null);
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
        // `0` is "the host reported no page size" — see `applyPageSize`.
        // There is no page to cut to, so draw everything that arrived.
        if (this.appliedPageSize <= 0 || ids.length <= this.appliedPageSize) {
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
        this.body.appendChild(p);
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

            // The platform hands over only the records of the current page, so
            // an id without a record is an ordinary state rather than an error.
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
     * a second source of truth that a sort, a filter or a refresh silently
     * invalidates.
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
        // Chevron then label. Decoration on a button that already says what it
        // does, so the accessible name is unchanged.
        previous.append(
            icon('CompactList-chevron', CHEVRON_PREVIOUS, STROKED),
            document.createTextNode(getString('CompactList_Previous')),
        );
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
        // Label then chevron: the glyph points the way the button goes, so it
        // trails rather than leads.
        next.append(
            document.createTextNode(getString('CompactList_Next')),
            icon('CompactList-chevron', CHEVRON_NEXT, STROKED),
        );
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

/**
 * Escape what SQL `LIKE` treats as a wildcard, so a typed `%` matches a `%`.
 *
 * `%`, `_` and `[` are the three, and the escape is a character class rather
 * than a backslash: `[%]`, `[_]`, `[[]`. A backslash is not an escape character
 * here and would be searched for literally.
 *
 * Without this, typing `%` matches every record in the table — a search box
 * that appears to ignore what was typed — and typing `_` quietly matches any
 * single character.
 */
function escapeLike(term: string): string {
    return term.replace(/[%_[]/g, (character) => `[${character}]`);
}

/** The SVG namespace. `createElement('svg')` makes an *HTML* element of that
 *  name: it parses, it appends, it occupies no space and draws nothing. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Fluent's magnifier and dismiss glyphs, filled, on a 20×20 grid. */
const SEARCH_PATHS = ['M8.5 3a5.5 5.5 0 1 0 3.35 9.86l3.65 3.64 1.06-1.06-3.64-3.65A5.5 5.5 0 0 0 8.5 3Zm-4 5.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z'];
const CLEAR_PATHS = ['M4.4 4.55 4.5 4.44a.5.5 0 0 1 .64-.06l.07.06L10 9.29l4.79-4.85a.5.5 0 0 1 .78.63l-.06.07L10.71 10l4.85 4.79a.5.5 0 0 1-.63.78l-.07-.06L10 10.71l-4.79 4.85a.5.5 0 0 1-.78-.63l.06-.07L9.29 10 4.44 5.21a.5.5 0 0 1-.06-.64l.06-.07-.1.11Z'];

/** The pager chevrons, stroked rather than filled — two lines each. */
const CHEVRON_PREVIOUS = ['M12.5 5 7.5 10l5 5'];
const CHEVRON_NEXT = ['M7.5 5l5 5-5 5'];

/** Filled glyph attributes, and stroked ones. */
const FILLED = { fill: 'currentColor' };
const STROKED = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
};

/**
 * An inline `<svg>`, which is the only kind of icon that can follow the theme.
 *
 * An image behind `<img src>` — file or data URL, PNG or SVG — renders as an
 * isolated document that cannot see this page's stylesheet, so a
 * `currentColor` inside it resolves to black and a dark form gets a black icon
 * on a dark background. `pcf-file-drop` shipped exactly that and it was found
 * on a real form. Inline, `currentColor` resolves against the `color` the
 * stylesheet sets, and the icon follows light and dark for free.
 *
 * Always decorative: every icon in this control sits on something that already
 * has an accessible name — the field has its label, the button has its
 * `aria-label` or its text — so announcing the glyph as well would only add a
 * word.
 */
function icon(className: string, paths: string[], attrs: Record<string, string> = FILLED): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

    // `classList`, because `className` on an SVG element is a read-only
    // `SVGAnimatedString` and assigning to it silently does nothing.
    svg.classList.add(className);
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, 'path');

        path.setAttribute('d', d);

        for (const [name, value] of Object.entries(attrs)) {
            path.setAttribute(name, value);
        }

        svg.appendChild(path);
    }

    return svg;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(Math.trunc(value), low), high);
}
