/**
 * Where the report routes live.
 *
 * Its own module because both halves need it and neither may import the other:
 * routes.js is Node and must never reach a browser bundle, and store.js is the
 * browser. A constant in a file they can both read is the whole of the shared
 * surface between them - everything else passes as JSON over four URLs.
 *
 * Double-underscored so it cannot collide with a route in the host application
 * that happens to be serving the designer.
 */

export const DEFAULT_PREFIX = '/__reports';
