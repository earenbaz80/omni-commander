import { configure } from '@testing-library/dom';

/**
 * Default wait for `findBy*`, `findAllBy*` and `waitFor`, in milliseconds.
 *
 * Testing Library ships one second, which is a budget for the assertion rather
 * than for the computer running it. A modal that resolves a mocked read and
 * re-renders does not get slower because the element is missing: it gets slower
 * because the box is compiling, swapping or running three other suites, and then
 * the query fails with "Unable to find an element" even though the component is
 * fine. That is the failure this keeps out of the local run.
 *
 * It only changes how long a query waits, never what it accepts: a test that
 * expects an element which never appears still fails, five seconds later. The
 * tests themselves keep the default timeout for their own bodies, so a hang is
 * still reported as a hang.
 */
configure({ asyncUtilTimeout: 5000 });
