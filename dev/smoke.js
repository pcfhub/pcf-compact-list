/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: installs the DOM and the platform globals, loads
 * `out/controls/CompactList/bundle.js` the way a form would, binds it to a
 * twelve-record view with three pages in it, and asserts what the control did —
 * both what it rendered and what it asked the platform for.
 *
 * Why it exists alongside `npm start` and `dev/harness.html`: half of what a
 * dataset control does is ask the platform for things, and a rendered list
 * shows none of it. Whether a page turn asked for page two or for "one more
 * page", whether a filter reset the page before refreshing, whether a page
 * size change settles or loops — those are decisions, they are what regresses,
 * and here they are assertions with an exit code.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run a handful of assertions against a bundle would be a dependency, a config
 * file and a second build pipeline for something `node` already does. It also
 * runs the **built bundle** rather than the TypeScript sources, which is the
 * part worth checking. CI runs it after the msbuild pack, so there it drives
 * the production bundle.
 *
 * **What passing here does NOT mean.** Every record below is supplied by this
 * file. It cannot tell you that a real view hands over what this fixture hands
 * over, that the server filters the same way, that `openDatasetItem` opens
 * anything, or that the control looks right. Keep those in SPEC.md under
 * "Still open".
 *
 * **The quirks default to the platform's observed misbehaviour, not to its
 * documentation**, and that is load-bearing. See the header of `dev/host.js`:
 * a harness modelling the platform as written down passes a control that cannot
 * page on a real form.
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

/*
 * Time, replaced with something the test drives.
 *
 * `vm.runInThisContext` below evaluates the bundle in *this* realm, so the
 * `Date` and `setTimeout` the control closes over are the ones installed here —
 * no injectable clock parameter, and therefore no production code bent to suit
 * a harness. The debounce around the search box is what needs it.
 */
const time = clock.install(Date.UTC(2026, 0, 1, 12, 0, 0), global);

const registration = host.captureRegistration(global);

vm.runInThisContext(fs.readFileSync(BUNDLE, 'utf8'), { filename: 'bundle.js' });

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

// `getString` returns a marked key rather than a real string, so an assertion
// can tell "read from the .resx" apart from "hardcoded in the source".
const marked = (key) => `resx:${key}`;

/**
 * Every control bound and not yet destroyed.
 *
 * A suite that binds and walks away is testing something other than what it
 * says: an abandoned control keeps its timers and its `document` listeners, so
 * the next section's counts include them. That is the leak the teardown
 * assertion exists to catch, and asserting it from inside one proves nothing.
 */
const live = [];

function disposeAll() {
    while (live.length > 0) {
        live.pop().destroy();
    }
}

/**
 * Every input property this control reads, with the manifest's own defaults.
 *
 * Stated in full rather than per test, and **not** left to fall through as
 * `undefined`: a missing property is not a state the platform produces — it
 * hands down `{ raw: … }` for every property in the manifest, defaulted if the
 * maker set nothing. A fixture that omits one tests the control's behaviour on
 * a host that does not exist, and the first run of this file crashed on exactly
 * that (`openOnItemClick.raw` of undefined).
 *
 * `pageSize` is 5 here rather than the manifest's unset, so that the fixture's
 * twelve records make three pages; the unset case has its own assertion.
 */
const INPUTS = {
    pageSize: 5,
    paging: 'pager',
    titleColumn: null,
    detailColumns: 3,
    showLabels: true,
    density: 'comfortable',
    openOnItemClick: true,
    showSearch: false,
    searchColumns: '',
    matchMode: 'startsWith',
    minimumCharacters: 2,
    debounceMs: 300,
};

/**
 * Bind a fresh control to a fresh view and render until it settles.
 *
 * `host.drive` renders repeatedly while the control owes another pass, so a
 * control that refreshes from inside `updateView` shows up as a count rather
 * than a stack overflow. That is a real failure mode for this shape: every
 * mutator has to be followed by `refresh()`, and `refresh()` causes another
 * `updateView`.
 */
function bind(options) {
    const settings = { ...options, inputs: { ...INPUTS, ...((options || {}).inputs || {}) } };
    const handle = host.createHost(fixture, { getString: marked, ...settings });
    const container = dom.createElement('div');
    const instance = new registration.ctor();

    let notifications = 0;

    instance.init(handle.context, () => {
        notifications += 1;
    }, {}, container);

    let driven = host.drive(instance, handle, 10);

    const view = {
        instance,
        container,
        handle,
        get driven() {
            return driven;
        },
        calls: () => handle.state.calls,
        /** How many times the control said its outputs changed. */
        notifications: () => notifications,
        outputs: () => instance.getOutputs(),
        find: (selector) => container.querySelector(selector),
        all: (selector) => container.querySelectorAll(selector),
        text: (selector) => {
            const found = container.querySelector(selector);

            return found === null ? null : found.textContent;
        },
        /** Let the platform catch up after something the control asked for. */
        settle: () => {
            driven = host.drive(instance, handle, 10);

            return driven;
        },
        /** Unmount, as the platform does when the form closes or navigates. */
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

/** A bind with the search bar turned on. */
const search = (options = {}) => bind({ ...options, inputs: { showSearch: true, ...(options.inputs || {}) } });

/** Type into the search box the way a user does, then let the debounce fire. */
function type(view, text, { settle = true } = {}) {
    const box = view.find('.CompactList-search');

    box.value = text;
    box.dispatchEvent({ type: 'input', target: box });

    if (settle) {
        // Past whatever `debounceMs` the caller set; the longest here is 300.
        time.advance(1000);
        view.settle();
    }

    return box;
}

/** Everything the control asked the platform for, since binding. */
const calls = (view) => view.calls().join(' ');

/** The expression currently set on the view, if any. */
const expressionOn = (view) => view.handle.dataset.filtering && view.handle.dataset.filtering.getFilter();

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/* -------------------------------------------------------------- settling */

const plain = bind({});

/*
 * **The failure this shape is famous for.** `setPageSize` does not re-fetch, so
 * it has to be followed by `refresh()` — and `refresh()` fires another
 * `updateView`. A control that asks unconditionally never stops. Three guarded
 * mutators share one `updateView` here, so this is also the check that none
 * of them fires on the first pass for no reason.
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
const untouched = bind({ inputs: { pageSize: null } });

check(
    'an unset page size overrides nothing — the host is already paging',
    untouched.calls().filter((call) => call.startsWith('setPageSize')).length === 0
        && !untouched.driven.looping
        && untouched.driven.passes === 1,
    `${untouched.driven.passes} passes, calls: ${calls(untouched)}`,
);

/*
 * **Repaginating resets the page, and applying the first size does not.**
 *
 * A page size that changes *after* one has been applied recuts the result set,
 * so "page 3" stops meaning what it meant and the platform answers a request
 * for it with nothing. The first application is the other case: at mount the
 * platform is already on page one, and `reset()` is itself a fetch — so
 * resetting there buys a round trip for nothing.
 *
 * Mutating the maker's input mid-flight is the only way to reach this from a
 * suite. The property is read fresh from `options.inputs` on every pass, so
 * this models a property edited in the form designer.
 */
const repaginated = bind({ inputs: { pageSize: 4 } });
const resets = (view) => view.calls().filter((call) => call === 'paging.reset').length;
const resetOnMount = resets(repaginated);

repaginated.handle.options.inputs.pageSize = 9;
repaginated.settle();

check(
    'the first page size costs no reset, and changing it afterwards does',
    resetOnMount === 0 && resets(repaginated) === 1,
    `${resetOnMount} at mount, ${resets(repaginated)} after the change`,
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

const second = bind({});

second.find('.CompactList-next').click();
second.settle();

check('page two replaces page one rather than stacking under it', second.all('.CompactList-item').length === 5, `${second.all('.CompactList-item').length} items on page 2`);

/*
 * **The pager chevrons are inline `<svg>`, and that is a theming decision.**
 *
 * The same glyph behind an `<img src>` — a resource, a data URL, PNG or SVG
 * alike — renders in an isolated document that cannot see this control’s
 * stylesheet, so its `currentColor` resolves to black and a dark form gets a
 * black chevron on a dark background. `pcf-file-drop` shipped exactly that and
 * it was found on a real form, not in review.
 */
for (const [what, selector] of [['previous', '.CompactList-previous'], ['next', '.CompactList-next']]) {
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

/*
 * **`hasPreviousPage` stays false after paging forward**, which is a platform
 * quirk rather than a fixture convenience — so a Previous button driven off it
 * never unlocks, and the control has to track the page itself.
 */
check(
    'knows it is on page two even though the platform reports no previous page',
    second.find('.CompactList-previous') !== null && second.find('.CompactList-previous').disabled === false,
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
const more = bind({ inputs: { paging: 'loadMore' } });

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
const uncounted = bind({ quirks: { uncounted: true } });

check(
    'never prints a total the platform said it does not have',
    !String(uncounted.text('.CompactList-status')).includes('-1'),
    uncounted.text('.CompactList-status'),
);

check(
    'renders nothing visible when the host says it is hidden',
    bind({ visible: false }).container.classList.contains('CompactList--hidden'),
);

check(
    'takes no position on the theme when the host publishes none',
    !bind({ host: 'canvas' }).container.classList.contains('CompactList--dark'),
);

check(
    'and follows the host theme where there is one',
    bind({ host: 'model-driven', dark: true }).container.classList.contains('CompactList--dark'),
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
    plain.text('.CompactList-title') === 'Fabrikam Manufacturing',
    plain.text('.CompactList-title'),
);

const titled = bind({ inputs: { titleColumn: 'accountnumber' } });

check(
    'and the column the maker named when they did',
    String(titled.text('.CompactList-title')).startsWith('ACC'),
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

/*
 * A button that does nothing is worse than no button: it takes a tab stop and
 * promises an action. Where clicking is configured to do nothing, the title is
 * a span.
 */
const inert = bind({ inputs: { openOnItemClick: false } });

check(
    'renders no button where clicking a record is configured to do nothing',
    !inert.find('button.CompactList-title') && Boolean(inert.find('span.CompactList-title')),
);

/* --------------------------------------------------------------- opening */

const opening = bind({});
const openButton = opening.all('.CompactList-item')[0].querySelector('button');

if (openButton) {
    openButton.click();
}

check(
    'opening a record asks the platform to navigate rather than routing itself',
    opening.calls().some((call) => call.startsWith('openDatasetItem')),
    opening.calls().join(' '),
);

/* ======================================================================== *
 *  The search bar.
 *
 *  Off by default, and the first assertions are about that: a form that
 *  never asked for a search box gets exactly the control it had before.
 * ======================================================================== */

/*
 * **Off means absent, not empty.** The bar is in the DOM — it is built once in
 * `init` — but hidden, and nothing about `dataset.filtering` is ever touched.
 * A list that filtered on load, or cleared a filter nobody set, would cost a
 * round trip on every form the control was already on.
 */
check(
    'with search off the bar is hidden and filtering is never touched',
    plain.find('.CompactList-bar').hidden === true && !calls(plain).includes('filtering.'),
    `hidden: ${plain.find('.CompactList-bar').hidden}, calls: ${calls(plain)}`,
);

const view = search({});

check('with search on the bar is shown', view.find('.CompactList-bar').hidden === false);

check(
    'and turning it on costs no extra pass — the first render applies no filter',
    !view.driven.looping && view.driven.passes === plain.driven.passes && !calls(view).includes('filtering.'),
    `${view.driven.passes} passes, calls: ${calls(view)}`,
);

/* ------------------------------------------------------------ the search box */

/*
 * **The structural claim the search bar rests on.**
 *
 * The list rebuilds on every render, which is fine for records and fatal for a
 * text input: `refresh()` causes a render, so the box the user is typing in
 * would cease to exist on the first keystroke. Same element, same value, after
 * the platform has been through several passes.
 */
const typing = search({});
const box = typing.find('.CompactList-search');

box.value = 'contoso';
typing.settle();
typing.settle();

check(
    'the search box survives a render, because it is built once and never rebuilt',
    typing.find('.CompactList-search') === box && box.value === 'contoso',
    typing.find('.CompactList-search') === box ? `value: ${box.value}` : 'the element was replaced',
);

check(
    'its accessible name is the maker’s label for this control, not a resource string',
    box.getAttribute('aria-label') === 'Active Accounts',
    box.getAttribute('aria-label'),
);

check(
    'and the placeholder names the number of characters it is waiting for',
    view.find('.CompactList-search').placeholder === 'resx:CompactList_SearchHint',
    view.find('.CompactList-search').placeholder,
);

/*
 * **Both icons are inline `<svg>`**, same rule as the chevrons: an `<img>`
 * would look identical in a light theme and black in a dark one.
 */
for (const [what, selector] of [['magnifier', '.CompactList-searchIcon'], ['clear glyph', '.CompactList-clearIcon']]) {
    check(
        `the ${what} is an inline svg, not an image`,
        view.find(selector) && view.find(selector).tagName.toLowerCase() === 'svg',
        view.find(selector) ? view.find(selector).tagName : 'missing',
    );

    check(
        `and is filled with currentColor, so the stylesheet decides the ${what}'s colour`,
        view
            .find(selector)
            .querySelectorAll('path')
            .every((path) => path.getAttribute('fill') === 'currentColor'),
    );

    check(
        `and hidden from the accessibility tree, because the ${what} names nothing`,
        view.find(selector).getAttribute('aria-hidden') === 'true',
    );
}

/*
 * **An icon-only button still has to have a name.** The label is an
 * `aria-label` read from the .resx, so a screen reader hears what it would
 * have heard from text, and a sighted user gets it back on hover as a `title`.
 * Dropping the text without this is how an icon button ships as "button".
 */
check(
    'the clear button carries no text, and takes its name from the .resx instead',
    view.find('.CompactList-clear').textContent === ''
        && view.find('.CompactList-clear').getAttribute('aria-label') === 'resx:CompactList_Clear'
        && view.find('.CompactList-clear').title === 'resx:CompactList_Clear',
    `text: ${JSON.stringify(view.find('.CompactList-clear').textContent)}, `
        + `label: ${view.find('.CompactList-clear').getAttribute('aria-label')}`,
);

/* ------------------------------------------------------------- filtering */

/*
 * **Below the minimum, nothing is asked for at all.**
 *
 * Not "a filter that matches everything" — no filter, and no refresh either.
 * A control that queries on the first keystroke asks the server for `a%` across
 * every text column of the table, which is the most expensive query it will
 * ever send and the least useful.
 */
const short = search({});

type(short, 'c');

check(
    'a term below the minimum never touches the platform — no clear, no reset, no refresh',
    expressionOn(short) === undefined && !calls(short).includes('filtering.'),
    calls(short),
);

const filtered = search({});

type(filtered, 'contoso');

/*
 * **The order is the contract**: set the expression, reset the page, then
 * refresh. Each one is a bug on its own — an unset filter is a search that does
 * nothing, an unreset page asks for page three of a one-page result set and
 * gets nothing back, and a missing refresh looks exactly like a filter that
 * matched nothing.
 */
const sequence = filtered.calls();
const setAt = sequence.findIndex((call) => call.startsWith('filtering.setFilter'));
const resetAt = sequence.indexOf('paging.reset', setAt);
const refreshAt = sequence.indexOf('refresh', resetAt);

check(
    'sets the filter, resets the page, then refreshes — in that order',
    setAt !== -1 && resetAt > setAt && refreshAt > resetAt,
    sequence.join(' '),
);

const expression = expressionOn(filtered);

check(
    'the expression is an Or, because a term in every column at once matches nothing',
    expression && expression.filterOperator === host.OR,
    expression ? `filterOperator: ${expression.filterOperator}` : 'no expression',
);

/*
 * A `Like` against a whole number or a lookup is a query the server rejects,
 * and the rejection names the column rather than the control. The fixture's
 * five columns include an OptionSet, a Lookup and a hidden one; three are text.
 */
check(
    'over the view’s text columns only, and not the hidden one',
    expression
        && expression.conditions.every((condition) => condition.conditionOperator === host.OPERATOR.Like)
        && expression.conditions.map((condition) => condition.attributeName).sort().join(',')
            === 'accountnumber,name,primarycontactname',
    expression ? expression.conditions.map((condition) => condition.attributeName).join(',') : 'none',
);

check(
    'and it actually narrows the view',
    filtered.handle.dataset.paging.totalResultCount === 1 && filtered.all('.CompactList-item').length === 1,
    `${filtered.handle.dataset.paging.totalResultCount} of ${fixture.records.length}`,
);

/*
 * **The guard that keeps this from being an infinite loop.**
 *
 * Every filter path ends in `refresh()`, and `refresh()` ends in `updateView`.
 * Re-applying an expression the platform is already filtering by would refresh
 * again, and again — which a browser shows as a hang rather than as a loop.
 */
const before = filtered.calls().length;

type(filtered, 'contoso');

check(
    're-applying the same term asks for nothing further',
    filtered.calls().length === before,
    `${before} → ${filtered.calls().length} calls`,
);

/*
 * The debounce is the difference between one query and one per keystroke. Three
 * keystrokes inside the window are one request.
 */
const debounced = search({});

type(debounced, 'con', { settle: false });
time.advance(100);
type(debounced, 'cont', { settle: false });
time.advance(100);
type(debounced, 'contoso', { settle: false });
time.advance(1000);
debounced.settle();

check(
    'keystrokes inside the debounce window produce one query, not one each',
    debounced.calls().filter((call) => call.startsWith('filtering.setFilter')).length === 1,
    debounced.calls().filter((call) => call.startsWith('filtering.setFilter')).join(' '),
);

/*
 * **`%` and `_` are wildcards, and a user typing one means the character.**
 *
 * Unescaped, a typed `%` matches every record in the table — a search box that
 * appears to ignore what was typed — and `_` quietly matches any single
 * character. The escape is a character class, `[%]`, because a backslash is not
 * an escape character in SQL `LIKE`.
 */
const wildcard = search({});

type(wildcard, '50%');

check(
    'a typed wildcard is escaped as a character class, not passed through',
    expressionOn(wildcard) && expressionOn(wildcard).conditions[0].value === '50[%]%',
    expressionOn(wildcard) ? expressionOn(wildcard).conditions[0].value : 'no expression',
);

const contains = search({ inputs: { matchMode: 'contains' } });

type(contains, 'logistics');

check(
    'contains wraps the term; starts-with only appends',
    expressionOn(contains) && expressionOn(contains).conditions[0].value === '%logistics%',
    expressionOn(contains) ? expressionOn(contains).conditions[0].value : 'no expression',
);

/*
 * A maker's typed column list is where free text stops being data and starts
 * being part of a query. What cannot be a logical name is dropped; what is
 * merely *wrong* is passed through, because the server's rejection is the only
 * thing that will ever name it.
 */
const named = search({ inputs: { searchColumns: 'name, accountnumber ,DROP TABLE, cr123_notacolumn' } });

type(named, 'contoso');

check(
    'searches the columns the maker named, dropping what cannot be a logical name',
    expressionOn(named)
        && expressionOn(named).conditions.map((condition) => condition.attributeName).join(',')
            === 'name,accountnumber,cr123_notacolumn',
    expressionOn(named)
        ? expressionOn(named).conditions.map((condition) => condition.attributeName).join(',')
        : 'no expression',
);

/* -------------------------------------------------------------- clearing */

const cleared = search({});

type(cleared, 'contoso');
cleared.find('.CompactList-clear').click();
time.advance(1000);
cleared.settle();

check(
    'Clear empties the box and clears the filter',
    cleared.find('.CompactList-search').value === ''
        && calls(cleared).includes('filtering.clearFilter')
        && expressionOn(cleared) === undefined,
    calls(cleared),
);

check(
    'and the whole view comes back',
    cleared.handle.dataset.paging.totalResultCount === fixture.records.length,
    String(cleared.handle.dataset.paging.totalResultCount),
);

/*
 * **Turning the search bar off while a filter is in force restores the view.**
 *
 * Otherwise the list stays narrowed with no box left to widen it — a maker
 * flipping the property off in the designer would see a list of one record
 * and no way to explain it. Once, and through the same guard as Clear: a bar
 * turned off with nothing typed must cost nothing.
 */
const switchedOff = search({});

type(switchedOff, 'contoso');

const clearsBefore = switchedOff.calls().filter((call) => call === 'filtering.clearFilter').length;

switchedOff.handle.options.inputs.showSearch = false;
switchedOff.settle();

check(
    'turning search off with a term in force clears the filter, once',
    switchedOff.calls().filter((call) => call === 'filtering.clearFilter').length === clearsBefore + 1
        && expressionOn(switchedOff) === undefined
        && switchedOff.find('.CompactList-bar').hidden === true
        && switchedOff.all('.CompactList-item').length === 5,
    `${clearsBefore} → ${switchedOff.calls().filter((call) => call === 'filtering.clearFilter').length} clears, `
        + `${switchedOff.all('.CompactList-item').length} items`,
);

const idleOff = search({});

idleOff.handle.options.inputs.showSearch = false;
idleOff.settle();

check(
    'and turning it off with nothing typed touches nothing',
    !calls(idleOff).includes('filtering.'),
    calls(idleOff),
);

/*
 * "No records" and "nothing matched your search" are different sentences, and
 * showing the first after a search reads as an empty view rather than as a
 * search that found nothing.
 */
const nothing = search({});

type(nothing, 'zzzzz');

check(
    'a search that matches nothing says so, rather than saying the view is empty',
    nothing.text('.CompactList-message') === 'resx:CompactList_NoMatches',
    nothing.text('.CompactList-message'),
);

check(
    'and an unfiltered empty view still says the view is empty',
    search({ records: [] }).text('.CompactList-message') === 'resx:CompactList_Empty',
);

/* ------------------------------------------------------ search × load more */

/*
 * **A filter collapses an accumulated list.** Pages 1..N of the unfiltered view
 * are not a prefix of the filtered one, so `paging.reset()` starts the range
 * over and the list shrinks to page one of what matched — rather than
 * appending one matching record under ten that no longer match.
 *
 * The combination neither control had run before the merge.
 */
const moreFiltered = search({ inputs: { paging: 'loadMore' } });

moreFiltered.find('.CompactList-loadMore').click();
moreFiltered.settle();

const accumulated = moreFiltered.all('.CompactList-item').length;

type(moreFiltered, 'contoso');

check(
    'searching a load-more list collapses it to page one of the matches',
    accumulated > 5 && moreFiltered.all('.CompactList-item').length === 1,
    `${accumulated} items before the search, ${moreFiltered.all('.CompactList-item').length} after`,
);

/* -------------------------------------------------------- nothing to search */

/*
 * **The host that supplies no `dataset.filtering`.**
 *
 * Typed as always present, which is a claim about the type definitions rather
 * than about the host. It must not throw, and it must not accept keystrokes
 * that could not do anything.
 */
let absentError = null;
let unfilterable = null;

try {
    unfilterable = search({ quirks: { filteringAbsent: true } });
} catch (error) {
    absentError = `${error.constructor.name}: ${error.message}`;
}

check(
    'renders on a host that supplies no filtering object',
    absentError === null && unfilterable !== null && unfilterable.all('.CompactList-item').length === 5,
    absentError || 'filtering was undefined',
);

check(
    'and says so in the box rather than accepting keystrokes that do nothing',
    unfilterable
        && unfilterable.find('.CompactList-search').disabled === true
        && unfilterable.find('.CompactList-search').placeholder === 'resx:CompactList_Unfilterable',
    unfilterable && unfilterable.find('.CompactList-search').placeholder,
);

/*
 * A view of nothing but numbers and lookups is the same state from the user's
 * side, so it gets the same sentence.
 */
const numbersOnly = search({
    columns: [
        { name: 'revenue', displayName: 'Revenue', dataType: 'Currency', alias: 'revenue', order: 0, isPrimary: true },
        { name: 'ownerid', displayName: 'Owner', dataType: 'Lookup.Simple', alias: 'ownerid', order: 1 },
    ],
});

check(
    'a view with no text column to search says the same thing',
    numbersOnly.find('.CompactList-search').disabled === true,
    numbersOnly.find('.CompactList-search').placeholder,
);

/* --------------------------------------------------------------- outputs */

const reporting = search({});

check(
    'reports the view’s count before anything is typed',
    reporting.outputs().filteredRecordCount === fixture.records.length,
    JSON.stringify(reporting.outputs()),
);

type(reporting, 'contoso');

check(
    'and the filtered count afterwards, from totalResultCount rather than the page',
    reporting.outputs().filteredRecordCount === 1 && reporting.outputs().searchTerm === 'contoso',
    JSON.stringify(reporting.outputs()),
);

/*
 * `-1` is what the platform reports for a view it did not count, and it travels
 * as `-1`: "none" and "unknown" are different answers, and a canvas formula can
 * tell them apart only if the control does not flatten them.
 */
check(
    'an uncounted view reports -1 rather than 0',
    search({ quirks: { uncounted: true } }).outputs().filteredRecordCount === -1,
    String(search({ quirks: { uncounted: true } }).outputs().filteredRecordCount),
);

/*
 * The list under the bar is the same list. `showLabels: false` in particular
 * still hides the `<dt>` visually and keeps it in the DOM.
 */
const searchUnlabelled = search({ inputs: { showLabels: false } });

check(
    'the list under the bar is the same list — labels off still keeps them for screen readers',
    searchUnlabelled.find('.CompactList-details').classList.contains('is-labelless')
        && searchUnlabelled.all('.CompactList-label').length === plain.all('.CompactList-label').length,
    `${searchUnlabelled.all('.CompactList-label').length} labels`,
);

/* --------------------------------------------------- what destroy owes */

/*
 * **Keep this when the rest of the file changes.** It is written against no
 * particular control and needs no knowledge of what this one takes.
 *
 * `destroy` is the lifecycle method with nothing visible riding on it, so it is
 * the one that quietly does nothing. A dataset control makes it worse than a
 * field control does: it is mounted and unmounted repeatedly, and each pass
 * leaves whatever the last one did not release.
 */
disposeAll();

const timersBefore = time.pending();
const listeners = () => Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0);
const listenersBefore = listeners();

bind({}).destroy();

check('destroy() releases every timer the control took', time.pending() === timersBefore, `${timersBefore} → ${time.pending()}`);

check('and every document-level listener', listeners() === listenersBefore, `${listenersBefore} → ${listeners()}`);

/*
 * **The one this control actually has to pay**, and the reason the assertion
 * above is not enough on its own: the debounce is scheduled by a keystroke
 * rather than by mounting, so a control that never clears it passes every
 * teardown check that only ever binds and destroys. Left running, it fires
 * against a dataset the platform has already released.
 */
const midSearch = search({});

type(midSearch, 'contoso', { settle: false });

const scheduled = time.pending();

midSearch.destroy();

check(
    'and the debounce still waiting to fire when the form closed',
    scheduled > timersBefore && time.pending() === timersBefore,
    `${scheduled} pending while typing → ${time.pending()} after destroy`,
);

const rerendered = search({});
const afterFirst = time.pending();

rerendered.settle();
rerendered.settle();
rerendered.settle();

check('and re-rendering does not add another one', time.pending() === afterFirst, `${afterFirst} → ${time.pending()}`);

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
