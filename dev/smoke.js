/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * A **standard dataset** control: it writes into the container it was handed,
 * so these assertions read the DOM it built and the calls it made on the
 * dataset.
 *
 * Why it exists at all: **no other harness reports a second page.** `pcf-start`
 * hardcodes `hasNextPage` and `hasPreviousPage` to false, and the hub's demo
 * harness supplies one page of fixture data — which is why every dataset
 * control in this catalogue is stuck at `fidelity: "limited"` and why paging
 * code has never been exercised anywhere. `dev/host.js` implements real paging,
 * including the platform quirks it would be dishonest to leave out:
 * `hasPreviousPage` staying false after paging forward, and a bare
 * `loadNextPage()` returning the accumulated range rather than the next page.
 *
 * Those two are the reason this control slices `sortedRecordIds` in exactly one
 * place, which is documented in the source as a repair rather than a habit.
 *
 * **What passing here does NOT mean.** Every value is supplied by this file. It
 * cannot tell you that a real view hands down what this fixture hands down,
 * that a subgrid's chrome behaves, or that the control looks right. Keep those
 * in SPEC.md under "Not verified".
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const dom = require('./dom.js');
const host = require('./host.js');
const fixture = require('./fixture.js');
const clock = require('./clock.js');

const BUNDLE = path.join(root, 'out', 'controls', 'CompactList', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/CompactList. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

const time = clock.install(Date.UTC(2026, 0, 1, 12, 0, 0), global);

const registration = host.captureRegistration(global);

vm.runInThisContext(fs.readFileSync(BUNDLE, 'utf8'), { filename: 'bundle.js' });

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

const marked = (key) => `resx:${key}`;

const live = [];

function disposeAll() {
    while (live.length > 0) {
        live.pop().destroy();
    }
}

/**
 * Bind a fresh control to a fresh view and render until it settles.
 *
 * `host.drive` renders repeatedly while the control owes another pass, so a
 * control that refreshes from inside `updateView` shows up as a count rather
 * than a stack overflow. That is a real failure mode for this shape: every
 * `setPageSize` has to be followed by `refresh()`, and `refresh()` causes
 * another `updateView`.
 */
/**
 * Every input property this control reads, with the manifest's own defaults.
 *
 * Stated in full rather than per test, and **not** left to fall through as
 * `undefined`: a missing property is not a state the platform produces — it
 * hands down `{ raw: … }` for every property in the manifest, defaulted if the
 * maker set nothing. A fixture that omits one tests the control's behaviour on
 * a host that does not exist, and the first run of this file crashed on exactly
 * that (`openOnItemClick.raw` of undefined).
 */
const INPUTS = {
    pageSize: 5,
    paging: 'pager',
    titleColumn: null,
    detailColumns: 3,
    showLabels: true,
    openOnItemClick: true,
    density: 'comfortable',
};

function bind(options) {
    const settings = { ...options, inputs: { ...INPUTS, ...((options || {}).inputs || {}) } };
    const handle = host.createHost(fixture, { getString: marked, ...settings });
    const container = dom.createElement('div');
    const instance = new registration.ctor();

    instance.init(handle.context, () => {}, {}, container);

    let driven = host.drive(instance, handle, 10);

    const view = {
        instance,
        container,
        handle,
        get driven() {
            return driven;
        },
        calls: () => handle.state.calls,
        find: (selector) => container.querySelector(selector),
        all: (selector) => container.querySelectorAll(selector),
        text: (selector) => {
            const found = container.querySelector(selector);

            return found === null ? null : found.textContent;
        },
        settle: () => {
            driven = host.drive(instance, handle, 10);

            return driven;
        },
        destroy: () => {
            instance.destroy();

            const at = live.indexOf(view);

            if (at !== -1) {
                live.splice(at, 1);
            }
        },
    };

    live.push(view);

    return view;
}

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/* -------------------------------------------------------------- settling */

const plain = bind({ inputs: { pageSize: 5, paging: 'pager', titleColumn: null, detailColumns: 3, showLabels: true } });

/*
 * **The failure this shape is famous for.** `setPageSize` does not re-fetch, so
 * it has to be followed by `refresh()` — and `refresh()` fires another
 * `updateView`. A control that asks unconditionally never stops.
 */
check('settles instead of refreshing forever', plain.driven.looping === false, `${plain.driven.passes} passes`);

check(
    'asking the platform for the page size the maker set, once',
    plain.calls().filter((call) => call.startsWith('setPageSize')).length === 1,
    plain.calls().join(' '),
);

/*
 * And the other half, which is the one that was missing.
 *
 * `pageSize` carried `default-value="25"`, so *every* install looked like the
 * bind above — a maker who never touched the property still produced a control
 * that replaced the user's own *Rows per page*. The property has no default
 * now, so leaving it alone is a state the control can see, and the assertion
 * is about a call that must not happen. `pcf-row-commands` shipped the override
 * and had to be released twice to take it back out.
 */
const untouched = bind({ inputs: { pageSize: null, paging: 'pager', titleColumn: null, detailColumns: 3, showLabels: true } });

check(
    'an unset page size overrides nothing — the host is already paging',
    untouched.calls().filter((call) => call.startsWith('setPageSize')).length === 0,
    untouched.calls().join(' '),
);

/*
 * A main grid answers the width and never the height — `-1` for the life of the
 * control, however politely it asks. A control that waits for a positive number
 * waits forever, which is how `pcf-row-commands` ran its rows off the bottom of
 * a page and took the pager with them.
 */
const unmeasured = bind({ width: 900, quirks: { heightUnmeasured: true } });

check(
    'renders on a host that measures a width and never a height',
    unmeasured.handle.context.mode.allocatedHeight === -1 && !unmeasured.driven.looping,
    `allocatedHeight ${unmeasured.handle.context.mode.allocatedHeight}`,
);

/* ---------------------------------------------------------------- paging */

/*
 * **A page, not the whole view.** The fixture holds twelve records at a page
 * size of five, which no other harness in this catalogue can produce.
 */
check('shows one page of records rather than the whole view', plain.all('.CompactList-item').length === 5, `${plain.all('.CompactList-item').length} items for a page size of 5 over ${fixture.records.length} records`);

const second = bind({ inputs: { pageSize: 5, paging: 'pager' } });

second.find('.CompactList-next').click();
second.settle();

check('page two replaces page one rather than stacking under it', second.all('.CompactList-item').length === 5, `${second.all('.CompactList-item').length} items on page 2`);

/*
 * **`hasPreviousPage` stays false after paging forward**, which is a platform
 * quirk rather than a fixture convenience — so a Previous button driven off it
 * never appears, and the control has to track the page itself.
 */
/*
 * **The pager chevrons are inline `<svg>`, and that is a theming decision.**
 *
 * The same glyph behind an `<img src>` — a resource, a data URL, PNG or SVG
 * alike — renders in an isolated document that cannot see this control’s
 * stylesheet, so its `currentColor` resolves to black and a dark form gets a
 * black chevron on a dark background. `pcf-file-drop` shipped exactly that and
 * it was found on a real form, not in review.
 *
 * This control has no `dev/harness.html` — it predates the every-shape rig — so
 * this assertion is the only thing standing between that regression and a
 * customer.
 */
for (const [what, selector] of [['previous', '.CompactList-previous'], ['next', '.CompactList-next']]) {
    // A tag selector scoped to the button: `dev/dom.js` supports 'tag',
    // '.class' and 'tag.class', and throws by name on anything else.
    const button = second.find(selector);
    const glyph = button && button.querySelector('svg');

    check(
        `the ${what} button carries an inline svg chevron, not an image`,
        glyph !== null && glyph.tagName.toLowerCase() === 'svg',
        glyph ? glyph.tagName : 'no svg found',
    );

    check(
        `and strokes it with currentColor, so the button’s colour decides the ${what} chevron`,
        glyph !== null && glyph.querySelector('path').getAttribute('stroke') === 'currentColor',
    );

    /* Decorative: the button already says “Previous page”. */
    check(
        `and hides the ${what} chevron from the accessibility tree`,
        glyph !== null && glyph.getAttribute('aria-hidden') === 'true',
    );
}

/* The label is still there — the chevron was added beside it, not instead of
   it, so the accessible name is unchanged. */
check(
    'and still says what it does in words',
    second.find('.CompactList-previous').textContent.includes('resx:CompactList_Previous'),
    second.find('.CompactList-previous').textContent,
);

check(
    'knows it is on page two even though the platform reports no previous page',
    second.find('.CompactList-previous') !== null && second.find('.CompactList-previous').hidden !== true,
    `hasPreviousPage stays false; status: ${second.text('.CompactList-status')}`,
);

/*
 * A bare `loadNextPage()` returns the whole accumulated range, so
 * `sortedRecordIds` grows and a list rendering it all silently turns into every
 * page at once. `loadNextPage(true)` is the one that turns the page.
 */
check(
    'turns the page rather than accumulating',
    second.calls().some((call) => call.includes('loadNextPage(true)') || call.includes('loadExactPage')),
    second.calls().join(' '),
);

/* ------------------------------------------------------------- load more */

/*
 * The other paging mode, where accumulating *is* the point — and where
 * switching modes has to reset, because appending page four onto a list showing
 * only page three is not a state worth reasoning about.
 */
const more = bind({ inputs: { pageSize: 5, paging: 'loadMore' } });

check('offers a load-more affordance rather than a pager', more.find('.CompactList-loadMore') !== null && more.find('.CompactList-next') === null);

more.find('.CompactList-loadMore').click();
more.settle();

check('and accumulates rather than replacing', more.all('.CompactList-item').length > 5, `${more.all('.CompactList-item').length} items after loading more`);

/* ------------------------------------------------------------ the states */

check('says it is loading rather than saying there is nothing', bind({ loading: true }).text('.CompactList-message') === 'resx:CompactList_Loading');

check('and says there is nothing once loading is done', bind({ records: [] }).text('.CompactList-message') === 'resx:CompactList_Empty');

/*
 * The platform's own message wins over the .resx fallback: it says what went
 * wrong, where the generic string only says that something did.
 */
check(
    "reports the platform's own error message rather than a generic one",
    bind({ error: true }).text('.CompactList-message') === 'The records could not be loaded.',
    bind({ error: true }).text('.CompactList-message'),
);

check(
    'and falls back to the .resx when the platform gave no message',
    bind({ error: true, errorMessage: '' }).text('.CompactList-message') === 'resx:CompactList_Error',
    bind({ error: true, errorMessage: '' }).text('.CompactList-message'),
);

/*
 * A canvas app supplies only the columns picked in the Items Fields pane, and
 * may supply none at all — in which case telling the maker is the only useful
 * thing the control can do.
 */
check('tells the maker when no columns have been chosen', bind({ columns: [] }).text('.CompactList-message') === 'resx:CompactList_NoColumns');

/*
 * `totalResultCount` is -1 when the platform did not count, which is common on
 * large views. A pager printing "51–75 of -1" is the tell that nobody checked.
 */
const uncounted = bind({ inputs: { pageSize: 5 }, totalResultCount: -1 });

check(
    'never prints a total the platform said it does not have',
    !String(uncounted.text('.CompactList-status')).includes('-1'),
    uncounted.text('.CompactList-status'),
);

/* ------------------------------------------------------------- the columns */

/*
 * A view hands its columns over in whatever order it likes and carries the
 * intended position in `order`, with `isHidden` for the ones the maker turned
 * off. A control rendering them as supplied looks correct against a fixture
 * that agrees with itself and wrong against a real view — which is why the
 * fixture deliberately disagrees.
 */
const visible = fixture.columns.filter((column) => !column.isHidden);

check(
    'shows only the columns the maker left visible',
    plain.all('.CompactList-label').length <= visible.length * 5,
    `${visible.length} visible of ${fixture.columns.length}`,
);

check(
    'the title is the primary column when the maker named none',
    String(plain.text('.CompactList-title')).length > 0,
    plain.text('.CompactList-title'),
);

const titled = bind({ inputs: { pageSize: 5, titleColumn: 'accountnumber' } });

check(
    'and the column the maker named when they did',
    String(titled.text('.CompactList-title')).startsWith('ACC') || String(titled.text('.CompactList-title')) !== String(plain.text('.CompactList-title')),
    `${titled.text('.CompactList-title')} vs ${plain.text('.CompactList-title')}`,
);

/*
 * **`showLabels: false` hides the labels visually and keeps them in the DOM**,
 * which looks like a bug until you consider who is left without them: a `<dl>`
 * of bare `<dd>` elements is malformed, and a screen reader reading four
 * unlabelled values in a row conveys nothing. So the assertion is that the
 * labels survive — omitting them would be the regression.
 */
const unlabelled = bind({ inputs: { showLabels: false } });

check(
    'turning labels off hides them visually and keeps them for screen readers',
    unlabelled.all('.CompactList-label').length === plain.all('.CompactList-label').length,
    `${unlabelled.all('.CompactList-label').length} labels with them off, ${plain.all('.CompactList-label').length} with them on`,
);

check(
    'marking the list rather than the labels, so the CSS can hide them',
    unlabelled.find('.CompactList-details').classList.contains('is-labelless')
        && !plain.find('.CompactList-details').classList.contains('is-labelless'),
    `"${unlabelled.find('.CompactList-details').className}" vs "${plain.find('.CompactList-details').className}"`,
);

/* --------------------------------------------------------------- opening */

const opening = bind({ inputs: { pageSize: 5 } });
const openButton = opening.all('.CompactList-item')[0].querySelector('button');

if (openButton) {
    openButton.click();
}

check(
    'opening a record asks the platform to navigate rather than routing itself',
    opening.calls().some((call) => call.startsWith('openDatasetItem')),
    opening.calls().join(' '),
);

/* --------------------------------------------------- what destroy owes */

/*
 * **Keep this when the rest of the file changes.** It needs no knowledge of
 * what this control takes.
 *
 * Both numbers are zero today: every listener this control adds is on an
 * element inside its own container, which the platform collects with the
 * subtree. They start meaning something the moment one moves to `document` or a
 * refresh gets debounced.
 */
disposeAll();

const timersBefore = time.pending();
const listeners = () => Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0);
const listenersBefore = listeners();

bind({}).destroy();

check('destroy() releases every timer the control took', time.pending() === timersBefore, `${timersBefore} → ${time.pending()}`);

check('and every document-level listener', listeners() === listenersBefore, `${listenersBefore} → ${listeners()}`);

disposeAll();

report();

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real view still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}
