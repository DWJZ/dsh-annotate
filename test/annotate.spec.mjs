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
/** Document listeners the plugin registers, so the suite can fire real events at it. */
const documentListeners = new Map()

const windowStub = { __ModuleLoader__: { load: (spec) => { windowStub.spec = spec } }, addEventListener: () => {}, removeEventListener: () => {}, scrollX: 0, scrollY: 0, getSelection: () => null }
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, style: {}, classList: { add: () => {} }, remove: () => {}, focus: () => {}, textContent: '', append: () => {} }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  addEventListener: (name, fn) => { const list = documentListeners.get(name) ?? []; list.push(fn); documentListeners.set(name, list) },
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

/** Every button in a rendered tree, in document order. */
const buttonsIn = (node, found = []) => {
  if (node === null || typeof node !== 'object') return found
  if (node.type === 'button') found.push(node)
  for (const child of node.children ?? []) buttonsIn(child, found)
  return found
}

console.log('the chip row sends the batch through the conversation face')
const sent = []
const registration = {}
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  locale: { register: () => {}, bind: () => t },
  sessions: {
    list: {
      getSnapshot: () => ({ ids: ['a'], byId: { a: { id: 'a', retainedBy: { mainView: 1 } } } }),
      subscribe: () => () => {},
    },
    scope: () => ({ id: 'scope' }),
    sessionOf: () => ({ prompt: (parts, mode) => { sent.push(`${mode}:${parts[0].text}`); return Promise.resolve({ ok: true }) } }),
  },
  uiConversation: { send: (text) => { sent.push(text); return Promise.resolve() } },
  slots: {
    inject: (name, factory) => { factory({}) },
    register: (options, component) => { registration.options = options; registration.component = component; return () => {} },
  },
}
exports.apply(ctx)
check('it registers into the composer dock', registration.options.name === 'conversation.input.dock')
exports.pending.set('a', [{ quote: 'q', comment: 'c' }])
const element = registration.component({ t, sessionId: 'a' })
check('the row renders while something waits', element !== null, String(element))
const buttons = buttonsIn(element)
check('one chip per annotation plus the send chip', buttons.length === 2, JSON.stringify(buttons.map(button => button.children?.[0])))
const sendChip = buttons.find(button => String(button.children?.[0]).startsWith('sendAllCount'))
check('the send chip carries the count', sendChip !== undefined && sendChip.children[0] === 'sendAllCount:1')
sendChip.props.onClick()
await new Promise((resolve) => { setTimeout(resolve, 20) })
check('the batch went out through the conversation send', sent.length === 1 && sent[0].includes('quoteLabel：「q」'), JSON.stringify(sent))
check('and the chips cleared', exports.pending.get('a').length === 0)
check('an empty list renders nothing', registration.component({ t, sessionId: 'a' }) === null)

console.log('removing one chip keeps the rest')
exports.pending.set('a', [{ quote: 'one', comment: 'c1' }, { quote: 'two', comment: 'c2' }])
const xMarks = buttonsIn(registration.component({ t, sessionId: 'a' })).filter(button => button.children?.[0] === '✕')
xMarks[0].props.onClick()
check('only the chosen annotation left', exports.pending.get('a').length === 1 && exports.pending.get('a')[0].quote === 'two', JSON.stringify(exports.pending.get('a')))


console.log('the floating card stays on screen')
const size = { width: 340, height: 200 }
const viewport = { width: 1000, height: 800 }
check('below the selection when it fits',
  JSON.stringify(exports.placeMath({ rect: { left: 100, top: 100, bottom: 120 }, size, viewport })) === JSON.stringify({ left: 100, top: 128 }))
check('above it when the bottom is out of room',
  JSON.stringify(exports.placeMath({ rect: { left: 100, top: 700, bottom: 720 }, size, viewport })) === JSON.stringify({ left: 100, top: 492 }))
check('clamped inward when neither side fits',
  exports.placeMath({ rect: { left: 100, top: 300, bottom: 320 }, size: { width: 340, height: 790 }, viewport }).top === 8)
check('and clamped away from the right edge',
  exports.placeMath({ rect: { left: 990, top: 0, bottom: 20 }, size, viewport }).left === 1000 - 340 - 8)

console.log(failures === 0 ? "\nPASS" : `\n${String(failures)} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
