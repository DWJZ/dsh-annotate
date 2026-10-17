/**
 * dsh-annotate — browser half (lazy-CJS client bundle).
 *
 * Select a passage of an answer, write one comment for it, repeat, then send the whole
 * set as a single message. Nothing is anchored to a message: the quote travels inside
 * the message, so what was annotated is legible to the model and to the person later
 * without this plugin storing anything.
 *
 * Two pieces of UI: a button that follows a text selection, and a dock above the
 * composer listing what is waiting to be sent. Highlights are best effort — the
 * selected ranges are painted with the CSS Custom Highlight API while they are still
 * valid, and the list, not the paint, is the record of what will be sent.
 */

window.__ModuleLoader__.load({
	id: "dsh-annotate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		//#region styles
		const CSS_ID = "dsh-annotate/styles.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", CSS_ID);
			tag.textContent = [
				".dsha_chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;width:100%;max-width:var(--dsh-composer-card-max-width,100%);margin:0 auto;padding:0 0 4px;box-sizing:border-box}",
				".dsha_chip{display:inline-flex;align-items:center;gap:6px;max-width:340px;height:26px;padding:0 8px;border-radius:999px;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);background:color-mix(in srgb,CanvasText 8%,Canvas);color:CanvasText;font:inherit;font-size:12px;line-height:1}",
				".dsha_chip_quote,.dsha_chip_comment{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".dsha_chip_quote{max-width:150px;opacity:.65}",
				".dsha_chip_comment{max-width:130px;font-weight:500}",
				".dsha_chip_x{border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;font:inherit;font-size:11px;padding:0}",
				".dsha_chip_x:hover{opacity:1}",
				".dsha_chip_send{cursor:pointer;border-color:transparent;background:CanvasText;color:Canvas;font-weight:600}",
				".dsha_chip_note{font-size:11px;opacity:.6}",
				".dsha_in{animation:dsha_in .12s ease-out}",
				".dsha_leave{animation:dsha_out .1s ease-in forwards}",
				"@keyframes dsha_in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}",
				"@keyframes dsha_out{to{opacity:0;transform:translateY(-4px) scale(.98)}}",
				".dsha_row{display:flex;align-items:center;gap:8px;justify-content:flex-end}",

				".dsha_grow{flex:1;min-width:0}",
				"::highlight(dsh-annotate){background-color:color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent)}"
			].join("");
			document.head.appendChild(tag);
		}
		//#endregion

		//#region locale
		const NS = "dshAnnotate";
		const zh = {
			annotate: "标注",
			title: "标注这段回答",
			comment: "备注",
			placeholder: "这条想说什么？（例如：这里应该是 X 而不是 Y）",
			hint: "Enter 保存 · Shift+Enter 换行",
			save: "保存",
			cancel: "取消",
			sendAllCount: "一起发送（{count}）",
			remove: "删除",
			sendAll: "一起发送",
			clear: "清空",
			noSend: "当前会话还不接受发送，先在这里攒着。",
			intro: "请逐条回应我对你上面回答的标注：",
			quoteLabel: "引用",
			commentLabel: "标注",
		};
		const en = {
			annotate: "Annotate",
			title: "Annotate this passage",
			comment: "Comment",
			placeholder: "What about it? (for example: this should be X, not Y)",
			hint: "Enter saves · Shift+Enter breaks the line",
			save: "Save",
			cancel: "Cancel",
			sendAllCount: "Send all ({count})",
			remove: "Remove",
			sendAll: "Send them together",
			clear: "Clear",
			noSend: "This Session cannot accept a message yet; the annotations wait here.",
			intro: "Please address each of my annotations on your answer above:",
			quoteLabel: "Quote",
			commentLabel: "Comment",
		};
		//#endregion

		//#region state
		/** Waiting annotations per Session: `{ quote, comment }`. */
		const pending = new Map();
		/** Rendered ranges per Session, kept only to paint the highlight. */
		const ranges = new Map();
		/** Dock subscribers, so one Session's list redraws when it changes. */
		const watchers = new Set();
		/**
		 * Send into the session-scoped conversation, captured from the slot injection.
		 *
		 * The composer's Enter handler runs outside any slot, so the one thing it needs is
		 * this closure: the injection is where a session-scoped ctx exists.
		 */
		let sendPending = null;
		/** `InputActions` from the composer slot: the native way to write the draft. */
		let inputActions = null;
		/** Latest `InputState` seen while rendering the chip row: the draft truth. */
		let lastInput = null;
		/**
		 * Why the last send failed, per Session, shown in the chip row.
		 *
		 * A failed send must be visible: the plugin takes over the composer's Enter, so a
		 * silent rejection would look exactly like "nothing happened".
		 */
		const problems = new Map();

		const itemsOf = (sessionId) => pending.get(sessionId) ?? [];

		/** Redraw every dock that is showing a waiting list. */
		function changed() {
			for (const watcher of watchers) watcher();
		}

		/**
		 * Send one already-composed message and clear what it carried.
		 * @param sessionId - the Session it belongs to.
		 * @param text - the message body.
		 * @returns the send, or undefined when nothing could be sent.
		 */
		function flush(sessionId, text) {
			if (!sendable(text)) return undefined;
			if (typeof sendPending !== "function") {
				problems.set(sessionId, "no-send");
				changed();
				return undefined;
			}
			// The send may refuse synchronously (a service without a Session scope does), so the
			// call itself is guarded: otherwise the click handler dies before any notice shows.
			let started
			try {
				started = sendPending(sessionId, text)
			} catch (failure) {
				problems.set(sessionId, String(failure?.message ?? failure));
				changed();
				return undefined;
			}
			return Promise.resolve(started).then(() => {
				pending.set(sessionId, []);
				problems.delete(sessionId);
				changed();
				return true;
			}).catch((failure) => {
				problems.set(sessionId, String(failure?.message ?? failure));
				changed();
				return false;
			});
		}

		/**
		 * Add one annotation to a Session's list.
		 * @param sessionId - the Session it was written in.
		 * @param quote - the selected text.
		 * @param comment - what the person wrote about it.
		 * @param range - the live range, when the selection could still be read.
		 */
		function add(sessionId, quote, comment, range) {
			const list = pending.get(sessionId) ?? [];
			list.push({ quote, comment });
			pending.set(sessionId, list);
			if (range !== undefined) {
				const painted = ranges.get(sessionId) ?? [];
				painted.push(range);
				ranges.set(sessionId, painted);
				paint(sessionId, painted);
			}
			changed();
		}
		//#endregion

		//#region message text
		/**
		 * Compose the one message that carries every waiting annotation.
		 * @param items - the annotations, in the order they were written.
		 * @param t - this namespace's translate function.
		 * @returns the message body, or the empty string when nothing waits.
		 */
		function composeBatch(items, t) {
			const list = Array.isArray(items) ? items : [];
			if (list.length === 0) return "";
			const lines = [t("intro"), ""];
			list.forEach((item, position) => {
				lines.push(`${String(position + 1)}. ${t("quoteLabel")}：「${collapse(item.quote)}」`)
				lines.push(`   ${t("commentLabel")}：${collapse(item.comment)}`)
				lines.push("")
			});
			return lines.join("\n").trimEnd();
		}

		/**
		 * Put one value on a single line, so a quote cannot break the numbered list.
		 * @param value - the raw text.
		 * @returns the flattened text.
		 */
		function collapse(value) {
			return String(value ?? "").replace(/\s+/gu, " ").trim();
		}

		/**
		 * Whether a message that carries these annotations is worth sending.
		 * @param text - the composed message.
		 * @returns true when it has content beyond the heading.
		 */
		function sendable(text) {
			return typeof text === "string" && text.trim() !== "";
		}
		//#endregion

		//#region highlight
		/**
		 * Paint one Session's ranges with the Custom Highlight API, when the browser has
		 * it. Nothing depends on the paint staying: the list is the record.
		 * @param sessionId - the Session those ranges belong to.
		 * @param list - the live ranges.
		 */
		function paint(sessionId, list) {
			if (typeof CSS === "undefined" || CSS.highlights === undefined || typeof Highlight === "undefined") return;
			const live = list.filter(range => range.startContainer?.isConnected === true);
			if (live.length === 0) return;
			CSS.highlights.set(`dsh-annotate-${sessionId}`, new Highlight(...live));
		}
		//#endregion

		//#region selection UI
		/** The element the floating button and editor live in. */
		let layer = null;
		/** The Session the open editor belongs to. */
		let editing = null;

		/**
		 * The layer that holds this plugin's floating UI.
		 *
		 * Fixed and pointer-transparent, so a child's offsets are viewport-relative and the
		 * layer never swallows a click meant for the page behind it.
		 */
		function layerOf() {
			if (layer !== null) return layer;
			layer = document.createElement("div");
			layer.setAttribute("data-dsh-annotate", "layer");
			layer.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;pointer-events:none";
			document.body.appendChild(layer);
			return layer;
		}

		/**
		 * Appearance shared by both floating surfaces.
		 *
		 * Inline on purpose: this is the one piece of UI that must be usable even when the
		 * stylesheet never arrives, and system colors follow the OS theme on their own.
		 */
		const SURFACE = "position:absolute;pointer-events:auto;box-sizing:border-box;border-radius:14px;"
			+ "background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);"
			+ "box-shadow:0 12px 36px rgb(0 0 0 / 28%);font:inherit";

		/**
		 * Remove the floating UI, letting its exit animation run unless told it must go now.
		 * @param immediate - drop it in the same frame.
		 */
		function dismiss(immediate = false) {
			editing = null;
			if (layer === null) return;
			const child = layer.firstElementChild;
			if (child === null) return;
			if (immediate === true) { layer.textContent = ""; return; }
			child.style.pointerEvents = "none";
			child.classList.add("dsha_leave");
			window.setTimeout(() => { if (child.parentNode === layer) child.remove(); }, 110);
		}

		/**
		 * The current selection, when it is a real one and not inside this plugin's own UI.
		 * @param selection - the document selection.
		 * @returns the text and range, or undefined.
		 */
		function readSelection(selection) {
			if (selection === null || selection === undefined || selection.isCollapsed === true) return undefined;
			const text = collapse(selection.toString());
			if (text === "") return undefined;
			const node = selection.anchorNode;
			const element = node === null ? null : node.nodeType === 1 ? node : node.parentElement;
			if (element === null || element === undefined) return undefined;
			// Only the Session's own text is annotatable: never this plugin's UI, and never an
			// editable surface — the composer, its placeholder, or the annotation box itself.
			if (element.closest?.("[data-dsh-annotate]") !== null) return undefined;
			if (element.closest?.('[contenteditable="true"], textarea, input') != null) return undefined;
			const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : undefined;
			return { text, range };
		}

		/**
		 * Place one floating element against a range, kept inside the viewport.
		 * @param element - the element to place.
		 * @param rect - the range's rectangle, in viewport coordinates.
		 */
		/**
		 * Where one floating element goes, given the selection and the viewport.
		 *
		 * Below the selection when it fits, above it when it does not, and clamped to the
		 * viewport otherwise — a card that runs off the bottom is unreadable exactly when it
		 * has the most to say.
		 * @param facts - selection rectangle, element size, and viewport size.
		 * @returns the top-left corner in viewport coordinates.
		 */
		function placeMath({ rect, size, viewport, margin = 8 }) {
			const left = Math.max(margin, Math.min(rect.left, Math.max(margin, viewport.width - size.width - margin)));
			const below = rect.bottom + margin;
			const above = rect.top - size.height - margin;
			const fitsBelow = below + size.height <= viewport.height - margin;
			const fitsAbove = above >= margin;
			let top;
			if (fitsBelow) top = below;
			else if (fitsAbove) top = above;
			else top = Math.max(margin, Math.min(below, viewport.height - size.height - margin));
			return { left: Math.round(left), top: Math.round(top) };
		}

		/**
		 * Place one floating element against a range.
		 * @param element - the element to place, already sized by the browser.
		 * @param rect - the range's rectangle, in viewport coordinates.
		 */
		function place(element, rect) {
			layerOf().appendChild(element);
			const size = {
				width: element.offsetWidth > 0 ? element.offsetWidth : 340,
				height: element.offsetHeight > 0 ? element.offsetHeight : 140,
			};
			const viewport = {
				width: document.documentElement.clientWidth,
				height: document.documentElement.clientHeight,
			};
			const spot = placeMath({ rect, size, viewport });
			element.style.left = `${String(spot.left)}px`;
			element.style.top = `${String(spot.top)}px`;
		}

		/**
		 * Offer the annotate button for the current selection.
		 * @param sessionId - the Session on screen, when one is.
		 * @param t - this namespace's translate function.
		 */
		function offer(sessionId, t, point) {
			const read = readSelection(window.getSelection());
			if (read === undefined || sessionId === undefined) { dismiss(); return; }
			// Beside the pointer when the release told us where it was, so the button lands where
			// the hand already is; the selection rectangle is the fallback for keyboard selections.
			const rect = point === undefined
				? read.range?.getBoundingClientRect()
				: { left: point.x + 12, top: point.y, bottom: point.y, width: 1, height: 1 };
			if (rect === undefined || (rect.width === 0 && rect.height === 0)) { dismiss(); return; }
			dismiss(true);
			const button = document.createElement("button");
			button.type = "button";
			button.className = "dsha_button dsha_in";
			button.textContent = t("annotate");
			button.style.cssText = `${SURFACE};height:28px;padding:0 12px;border-radius:999px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center`;
			button.addEventListener("mousedown", (event) => {
				// Opening the editor on mousedown, not click: a click clears the selection
				// first, and that selection is the quote the annotation carries.
				event.preventDefault();
				event.stopPropagation();
				editor(sessionId, read, t);
			});
			place(button, rect);
		}

		/**
		 * Ask for the comment that belongs to one selection.
		 * @param sessionId - the Session it was selected in.
		 * @param read - the selected text and its range.
		 * @param t - this namespace's translate function.
		 */
		function editor(sessionId, read, t) {
			dismiss(true);
			const rect = read.range?.getBoundingClientRect();
			const card = document.createElement("div");
			card.className = "dsha_card dsha_in";
			card.style.cssText = `${SURFACE};width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 16px);overflow:auto;display:flex;flex-direction:column;gap:10px;padding:14px`;
			// Presses inside the card belong to the card: the document handler must not
			// rebuild the layer from under an open editor.
			card.addEventListener("mousedown", (event) => { event.stopPropagation(); });

			const title = document.createElement("div");
			title.textContent = t("title");
			title.style.cssText = "font-size:12px;font-weight:600;opacity:.65";

			const quote = document.createElement("div");
			quote.className = "dsha_quote";
			quote.textContent = read.text;
			quote.style.cssText = "max-height:88px;overflow:auto;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.6;"
				+ "opacity:.85;white-space:pre-wrap;background:color-mix(in srgb,CanvasText 8%,Canvas)";

			const input = document.createElement("textarea");
			input.className = "dsha_input";
			input.placeholder = t("placeholder");
			// No native focus ring: the card already frames the box, and the browser's blue
			// outline reads as a different design language. The border carries the state instead.
			input.style.cssText = "width:100%;box-sizing:border-box;min-height:72px;max-height:40vh;resize:vertical;padding:9px 10px;"
				+ "border-radius:10px;font:inherit;font-size:13px;line-height:1.5;background:transparent;color:inherit;"
				+ "outline:none;appearance:none;box-shadow:none;"
				+ "border:1px solid color-mix(in srgb,CanvasText 28%,transparent)";

			const row = document.createElement("div");
			row.style.cssText = "display:flex;align-items:center;gap:8px";

			const hint = document.createElement("div");
			hint.textContent = t("hint");
			hint.style.cssText = "flex:1;font-size:11px;opacity:.55";

			const action = (text, primary) => {
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = text;
				button.style.cssText = "height:28px;padding:0 12px;border-radius:8px;font-size:12px;cursor:pointer;font:inherit;"
					+ (primary
						? "background:CanvasText;color:Canvas;border:1px solid transparent;font-weight:600"
						: "background:transparent;color:inherit;border:1px solid color-mix(in srgb,CanvasText 22%,transparent)");
				return button;
			};
			const commit = () => {
				const comment = collapse(input.value);
				if (comment === "") { input.focus(); return; }
				add(sessionId, read.text, comment, read.range);
				const problem = problems.get(sessionId) ?? "";
				if (problem === "") { dismiss(); return; }
				hint.textContent = problem === "no-send" ? t("noSend") : problem;
				hint.style.opacity = "1";
			};
			const cancel = action(t("cancel"), false);
			cancel.addEventListener("click", () => { dismiss(); });
			const save = action(t("save"), true);
			save.addEventListener("click", commit);
			// An Enter that is still composing a character belongs to the input method, not to
			// this card: with a Chinese IME the same key both accepts the candidate and would
			// otherwise save the annotation. `keyCode 229` covers the browsers that stop
			// reporting `isComposing` before the keydown that ends the composition.
			let composing = false;
			input.addEventListener("compositionstart", () => { composing = true; });
			input.addEventListener("compositionend", () => { window.setTimeout?.(() => { composing = false; }, 0); composing = false; });
			input.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" || event.shiftKey === true) return;
				if (event.isComposing === true || event.keyCode === 229 || composing === true) return;
				event.preventDefault();
				commit();
			});

			row.append(hint, cancel, save);
			card.append(title, quote, input, row);
			editing = sessionId;
			if (rect !== undefined) place(card, rect);
			input.focus();
		}
		//#endregion

//#region composer chips
		/**
		 * The chips at the top of the composer: one per waiting annotation, plus the action
		 * that sends them all. Native attachments live in the same strip, so a person reads
		 * both the same way — something attached to what they are about to send.
		 * @param props - the slot's props, plus the Session these chips belong to.
		 * @returns the chip row, or null while nothing waits.
		 */
		function AnnotateChips({ t, sessionId, useInput, inputActions: actions }) {
			// The composer slot provides both: the reactive draft and the native actions that write
			// it. Cached for the Enter handler, which runs outside this component.
			if (typeof actions?.setDraft === "function") inputActions = actions;
			if (typeof useInput === "function") {
				const state = useInput((value) => value);
				if (state !== undefined) lastInput = state;
			}
			const [, redraw] = React.useState(0);
			React.useEffect(() => {
				const watcher = () => { redraw((value) => value + 1) };
				watchers.add(watcher);
				return () => { watchers.delete(watcher) };
			}, []);
			const items = itemsOf(sessionId);
			const problem = problems.get(sessionId) ?? "";
			if (items.length === 0) return null;

			const remove = (position) => {
				const list = itemsOf(sessionId).slice();
				list.splice(position, 1);
				pending.set(sessionId, list);
				changed();
			};

			return React.createElement("div", { className: "dsha_chips" },
				...items.map((item, position) => React.createElement("span", {
					className: "dsha_chip",
					key: `${String(position)}-${item.quote.slice(0, 12)}`,
					// The chip is one line by design; the whole annotation is on hover.
					title: `「${item.quote}」\n${item.comment}`,
				},
				React.createElement("span", { className: "dsha_chip_quote" }, `「${item.quote}」`),
				React.createElement("span", { className: "dsha_chip_comment" }, item.comment),
				React.createElement("button", {
					type: "button",
					className: "dsha_chip_x",
					"aria-label": t("remove"),
					title: t("remove"),
					onClick: (event) => { event?.stopPropagation?.(); remove(position) },
				}, "✕"))),
				problem === "" ? null : React.createElement("span", { className: "dsha_chip_note" }, problem === "no-send" ? t("noSend") : problem));
		}
		//#endregion

				//#region plugin
		const inject = ["slots", "sessions", "locale", "uiConversation"];

		/**
		 * Watch selections, and mount the waiting list.
		 * @param ctx - the client plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-annotate: dictionaries");
			const t = ctx.locale.bind(NS);

			/** The Session the main view is showing, the same row the browser title reads. */
			const onScreen = () => {
				const { byId } = ctx.sessions.list.getSnapshot();
				return Object.values(byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id;
			};

			ctx.effect(() => {
				const onUp = (event) => {
					// A press inside this plugin's own UI must not rebuild the layer: it would
					// unmount the editor the same press is opening.
					const inside = event?.target?.closest?.("[data-dsh-annotate]") != null;
					if (inside) return;
					// A press anywhere else closes an open editor: the card belongs to the selection
					// that opened it.
					if (editing !== null) { dismiss(); return; }
					const point = typeof event?.clientX === "number" && typeof event?.clientY === "number"
						? { x: event.clientX, y: event.clientY }
						: undefined;
					offer(onScreen(), t, point);
				};
				const onKey = (event) => { if (event.key === "Escape") dismiss() };
				const onScroll = () => { if (editing === null) dismiss() };
				/**
				 * Enter in the composer sends the draft *and* the waiting annotations as one message.
				 *
				 * Captured before the composer sees the key, because its own submit would send the
				 * draft alone and leave the annotations behind. The draft is read off the editor and
				 * cleared through the editor's own editing command, since no plugin-facing API writes
				 * the composer.
				 */
				const onComposerEnter = (event) => {
					if (event.key !== "Enter" || event.shiftKey === true || event.isComposing === true) return;
					if (editing !== null) return;
					const target = event.target;
					if (target?.closest?.("[data-dsh-annotate]")) return;
					const textarea = target?.tagName === "TEXTAREA";
					const inEditor = target?.isContentEditable === true
						|| target?.closest?.('[contenteditable="true"]') != null;
					if (!textarea && !inEditor) return;
					const sessionId = onScreen() ?? [...pending.keys()].find(id => itemsOf(id).length > 0) ?? "";
					const batch = composeBatch(itemsOf(sessionId), t);
					if (!sendable(batch)) return;
					const raw = String(lastInput?.draft ?? (textarea ? target.value : target.innerText ?? target.textContent ?? ""));
					const draft = String(raw).trim();
					const text = draft === "" ? batch : `${draft}\n\n${batch}`;
					event.preventDefault();
					event.stopPropagation();
					void flush(sessionId, text).then((sent) => {
						// Only clear the box when the message really went out; a failed send must
						// leave the words where the person can try again.
						if (sent !== true) return;
						// The composer slot hands plugins the native draft writer; there is no
						// older runtime to support, so this is the only way the box gets cleared.
						inputActions?.setDraft?.("");
					});
				};
				// Capture phase: a control that stops propagation on its own mouseup must not be able
				// to leave the button or the card behind.
				document.addEventListener("mouseup", onUp, true);
				document.addEventListener("keydown", onKey);
				document.addEventListener("keydown", onComposerEnter, true);
				window.addEventListener("scroll", onScroll, true);
				return () => {
					document.removeEventListener("mouseup", onUp, true);
					document.removeEventListener("keydown", onKey);
					document.removeEventListener("keydown", onComposerEnter, true);
						window.removeEventListener("scroll", onScroll, true);
						if (layer !== null) { layer.remove(); layer = null }
				};
			}, "dsh-annotate: selection affordance");

			// The send uses the public conversation face: `IConversation.send` is contract, and the
			// session scope is what makes it target this Session's own turn.
			// The session face is the public way to put a message into a Session:
			// `sessions.sessionOf(scope).prompt(parts, 'queue')` is what the conversation service
			// itself calls for `send`, minus the private scoping it does on its own instance.
			sendPending = (sessionId, text) => {
				const scope = ctx.sessions.scope(sessionId);
				if (scope === undefined) throw new Error(t("noSend"));
				const session = ctx.sessions.sessionOf(scope);
				if (session === undefined) throw new Error(t("noSend"));
				return Promise.resolve(session.prompt([{ type: "text", text }], "queue")).then((outcome) => {
					if (outcome?.ok === false) {
						throw new Error(`prompt failed: ${String(outcome.error?.code)}: ${String(outcome.error?.message)}`);
					}
					return undefined;
				});
			};

			ctx.slots.inject("conversation.input.dock", () => {
				const dispose = ctx.slots.register({
					name: "conversation.input.dock",
					id: "annotate",
					order: 5,
					locale: NS,
				}, (props) => AnnotateChips({ ...props, sessionId: onScreen() ?? "" }));
				return () => { dispose() };
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		// Pure helpers, exported so the suite can pin the message it composes.
		exports.composeBatch = composeBatch;
		exports.readSelection = readSelection;
		exports.placeMath = placeMath;

		exports.collapse = collapse;
		exports.pending = pending;
		//#endregion

		return module.exports;
	}
});
