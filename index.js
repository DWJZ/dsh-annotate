/**
 * dsh-annotate — host half.
 *
 * The feature lives entirely in the browser: selecting a passage of an answer,
 * writing one comment per selection, and sending the set as a single message. This
 * half exists because the client graph is composed by scanning the Loader's entries
 * for packages that declare `dsh.client` — a package without a mounted row keeps its
 * client half invisible — so the row is what activates `client/client.js`.
 *
 * It deliberately registers nothing else: the annotations travel in the message the
 * person sends, so nothing has to be stored on the host for them to survive.
 */

/** Plugin name, as the Loader reports it. */
export const name = 'dsh-annotate'

/**
 * Mount the plugin.
 *
 * Nothing to mount: the browser half owns the whole feature, and the row above is
 * its activation. Kept as a real plugin so the manifest stays an ordinary bundle.
 */
export function apply() {}
