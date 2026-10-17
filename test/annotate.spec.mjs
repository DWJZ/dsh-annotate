/**
 * Unit checks for the annotation half: the message it composes, and that the dock
 * sends exactly that message once and then empties.
 *
 * Usage: `node test/annotate.spec.mjs`.
 */
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label} ${detail}`)
  }
}

//#region browser stubs
const windowStub = { __ModuleLoader__: { load: (spec) => { windowStub.spec = spec } }, addEventListener: () => {}, removeEventListener: () => {}, scrollX: 0, scrollY: 0, getSelection: () => null }
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {}, classList: { add: () => {} }, remove: () => {}, focus: () => {}, textContent: '', append: () => {} }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  documentElement: { clientWidth: 1200 },
}
globalThis.window = windowStub
globalThis.document = documentStub

await import(pathToFileURL(join(root, 'client/client.js')).href)
const spec = windowStub.spec
check('the bundle registers itself under the plugin id', spec?.id === 'dsh-annotate')
//#endregion

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: () => [null, () => {}],
  useEffect: () => {},
}
const exports = spec.factory((name) => (name === 'react' ? React : undefined))
check('the client half exports apply and inject', typeof exports.apply === 'function' && Array.isArray(exports.inject))
check('it injects the slots, sessions, locale and conversation services',
  ['slots', 'sessions', 'locale', 'uiConversation'].every(name => exports.inject.includes(name)), JSON.stringify(exports.inject))

// The real dictionary reads as prose; the suite only needs the labels to be present.
const t = (key, vars) => (vars === undefined ? key : `${key}:${String(vars.count ?? '')}`)

console.log('the message it composes')
const composed = exports.composeBatch([
  { quote: '这一步会覆盖原文件', comment: '这里应该先备份' },
  { quote: '大约 3 秒', comment: '这个数字是怎么来的？' },
], t)
check('it opens by asking for a point-by-point answer', composed.startsWith('intro'), JSON.stringify(composed.slice(0, 40)))
check('every quote is numbered and quoted', composed.includes('1. quoteLabel：「这一步会覆盖原文件」') && composed.includes('2. quoteLabel：「大约 3 秒」'), composed)
check('every comment follows its quote', composed.includes('commentLabel：这里应该先备份') && composed.includes('commentLabel：这个数字是怎么来的？'), composed)
check('nothing waiting composes nothing', exports.composeBatch([], t) === '')
check('a multi-line selection stays on one line', exports.composeBatch([{ quote: 'a\nb', comment: 'c\nd' }], t).includes('「a b」') && exports.composeBatch([{ quote: 'a\nb', comment: 'c\nd' }], t).includes('commentLabel：c d'))

console.log('the dock sends the whole set once')
const sent = []
const listListeners = []
let registration = null
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  locale: { register: () => {}, bind: () => t },
  sessions: { list: { getSnapshot: () => ({ ids: ['a'], byId: { a: { id: 'a', retainedBy: { mainView: 1 } } } }), subscribe: (fn) => { listListeners.push(fn); return () => {} } } },
  slots: { inject: (name, factory) => { factory({ uiConversation: { send: (text) => { sent.push(text); return Promise.resolve() } } }) }, register: (options, component) => { registration = { options, component }; return () => {} } },
  uiConversation: { send: () => Promise.resolve() },
}
exports.apply(ctx)
check('it registers one dock', registration !== null && registration.options.name === 'conversation.input.dock', JSON.stringify(registration?.options))
check('the dock is session-scoped by the owner, ordered before the todo dock', registration.options.order === 5)

exports.pending.set('a', [{ quote: 'q', comment: 'c' }])
const props = { t, sessionId: 'a', send: (text) => { sent.push(text); return Promise.resolve() } }
const element = registration.component(props)
check('the dock renders while something waits', element !== null, String(element))
/** Every button in a rendered tree, in document order. */
const buttonsIn = (node, found = []) => {
  if (node === null || typeof node !== 'object') return found
  if (node.type === 'button') found.push(node)
  for (const child of node.children ?? []) buttonsIn(child, found)
  return found
}
const buttons = buttonsIn(element)
check('it offers a send and a clear action', buttons.length === 3, JSON.stringify(buttons.map(button => button.children?.[0])))
const sendAll = buttons.find(button => button.children?.[0] === 'sendAll')
const removeOne = buttons.find(button => button.children?.[0] === 'remove')
check('the send action is there', sendAll !== undefined)
check('and a per-item remove action', removeOne !== undefined)
sendAll.props.onClick()
await new Promise((resolve) => { setTimeout(resolve, 20) })
check('the message went out once', sent.length === 1 && sent[0].includes('quoteLabel：「q」'), JSON.stringify(sent))
check('and the list was emptied', exports.pending.get('a').length === 0)
check('an empty list renders nothing', registration.component(props) === null)

console.log(failures === 0 ? '\nPASS' : `\n${String(failures)} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
