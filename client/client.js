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
				"::highlight(dsh-annotate){background-color:color-mix(in srgb,CanvasText 22%,transparent)}",
				"::highlight(dsh-annotate-active){background-color:color-mix(in srgb,#f0b429 34%,transparent)}"
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
		/**
		 * A draft that keeps the composer's own send button operable.
		 *
		 * The button is disabled while the draft is empty, and annotations live outside the draft,
		 * so an annotation-only message has no way to start from a click. A zero-width space makes
		 * the draft non-empty without showing anything; it is stripped before the message leaves.
		 */
		const PLACEHOLDER = "\u200b";

		/** Whether a draft carries nothing but the placeholder. */
		function blankDraft(text) {
			return String(text ?? "").replaceAll(PLACEHOLDER, "").trim() === "";
		}

		/**
		 * Keep the placeholder in step with the waiting annotations.
		 *
		 * Only touches an empty draft or a draft that is exactly the placeholder, so a person's own
		 * words are never overwritten.
		 * @param hasItems - whether any annotation is waiting.
		 */
		function syncPlaceholder(hasItems) {
			if (typeof inputActions?.setDraft !== "function") return;
			const draft = String(lastInput?.draft ?? "");
			if (hasItems === true) {
				if (draft.trim() === "") inputActions.setDraft(PLACEHOLDER);
				return;
			}
			if (blankDraft(draft)) inputActions.setDraft("");
		}

		/**
		 * The composer's own submit button.
		 *
		 * Clicking it is the only path that carries the draft's attachments: the plugin cannot
		 * serialize them itself, and a bare `prompt()` would send the text alone and leave the
		 * images behind.
		 * @returns the button, or null when this build renders it differently.
		 */
		function composerPrimary() {
			if (typeof document.querySelector !== "function") return null;
			return document.querySelector('[data-composer-card] button[class*="primary"]');
		}

		/**
		 * Send one composed message through the composer.
		 * @param text - the draft the person should have typed, annotations included.
		 * @returns whether the composer accepted the handoff.
		 */
		function submitThroughComposer(text) {
			if (typeof inputActions?.setDraft !== "function") return false;
			inputActions.setDraft(text);
			const button = composerPrimary();
			if (button === null || button === undefined || button.disabled === true) return false;
			button.click?.();
			return true;
		}

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
				syncPlaceholder(false);
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
			// The button is disabled on an empty draft, and annotations live outside it.
			syncPlaceholder(list.length > 0);
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
		/** Markers only the conversation rows carry; nothing else in the shell has all three. */
		const CHAT_ROW = "[data-chat-turn], [data-chat-anchor-key], [data-chat-flow-key]";

		/** Surfaces that are never annotatable, whatever they contain. */
		const FOREIGN = '[data-dsh-annotate], [contenteditable="true"], textarea, input, '
			+ '[role="dialog"], [role="menu"], [role="tooltip"], [aria-modal="true"]';

		/**
		 * Whether a selection anchored in this element is session text worth annotating.
		 *
		 * Settings sheets, menus and panels are ordinary DOM outside the conversation, and their
		 * text is just as selectable as an answer — so the test is positive: the anchor must sit
		 * inside a conversation row, and must not sit on an editable or a foreign surface.
		 * @param element - the selection's anchor element.
		 * @returns whether the plugin should offer to annotate it.
		 */
		function annotatableTarget(element) {
			if (element === null || element === undefined) return false;
			if (element.closest?.(FOREIGN) != null) return false;
			return element.closest?.(CHAT_ROW) != null;
		}

		/**
		 * What a press outside this plugin's own UI should do.
		 * @param facts - whether the press was inside the plugin UI, whether an editor is open, and
		 * how long ago it opened.
		 * @returns "ignore" when the press belongs to this plugin, "close" when an open card must
		 * close, or "drop" when the waiting button must go away.
		 */
		function pressAction({ inside, open, sinceOpened }) {
			if (inside === true) return "ignore";
			if (open === true) return sinceOpened < 300 ? "ignore" : "close";
			return "drop";
		}

		/**
		 * Whether a release earns a fresh annotation button.
		 * @param facts - whether the release was inside the plugin UI, whether an editor is open,
		 * the selection text when the press began, and the selection text now.
		 * @returns true only when the release left a selection that was not already there.
		 */
		function offerAction({ inside, open, pressed, current }) {
			if (inside === true || open === true) return false;
			if (pressed !== null && current === pressed) return false;
			return true;
		}

		/**
		 * Whether an Enter press in the annotation box belongs to the input method.
		 * @param facts - the key event's composition flags.
		 * @returns true when the key is still composing a character and must not save.
		 */
		function composingEnter({ isComposing, keyCode, composing }) {
			return isComposing === true || keyCode === 229 || composing === true;
		}

		/**
		 * Put the keyboard back in the composer, so a finished annotation can be sent with Enter
		 * alone. The composer is a contenteditable surface, and no plugin-facing action focuses it.
		 * @returns whether an element took the focus.
		 */
		function focusComposer() {
			if (typeof document.querySelector !== "function") return false;
			const editor = document.querySelector('[data-composer-card] [data-composer-input][contenteditable="true"]')
				?? document.querySelector('[data-composer-card] textarea');
			if (editor === null || editor === undefined) return false;
			editor.focus?.();
			return true;
		}

		/**
		 * Mark the passage being annotated right now, in the text itself.
		 *
		 * The card no longer repeats the quote: this paint is what tells the person which words
		 * the comment belongs to. It is temporary by design and cleared when the card closes.
		 * @param range - the selected range, or undefined to clear it.
		 */
		function paintActive(range) {
			if (typeof CSS === "undefined" || CSS.highlights === undefined || typeof Highlight === "undefined") return;
			if (range === undefined || range === null || range.startContainer?.isConnected !== true) {
				CSS.highlights.delete("dsh-annotate-active");
				return;
			}
			CSS.highlights.set("dsh-annotate-active", new Highlight(range));
		}

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
		/** When the open editor appeared: its own opening press must not close it. */
		let openedAt = 0;

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
			paintActive(undefined);
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
			// Only the Session's own text is annotatable: never this plugin's UI, never an editable
			// surface, and never a panel that merely happens to be selectable.
			if (!annotatableTarget(element)) return undefined;
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

			/** One inline stroke icon, sized for a small button. */
			const icon = (path, size) => {
				const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				svg.setAttribute("viewBox", "0 0 16 16");
				svg.setAttribute("width", String(size));
				svg.setAttribute("height", String(size));
				svg.setAttribute("fill", "none");
				svg.setAttribute("stroke", "currentColor");
				svg.setAttribute("stroke-width", "1.6");
				svg.setAttribute("stroke-linecap", "round");
				svg.setAttribute("stroke-linejoin", "round");
				svg.setAttribute("aria-hidden", "true");
				const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
				shape.setAttribute("d", path);
				svg.appendChild(shape);
				return svg;
			};
			const title = document.createElement("div");
			title.textContent = t("title");
			title.style.cssText = "font-size:12px;font-weight:600;opacity:.65";
			const close = document.createElement("button");
			close.type = "button";
			close.className = "dsha_icon";
			close.setAttribute("aria-label", t("cancel"));
			close.title = t("cancel");
			close.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;"
				+ "border:0;border-radius:8px;background:transparent;color:inherit;opacity:.6;cursor:pointer";
			close.appendChild(icon("M4 4 L12 12 M12 4 L4 12", 14));
			close.addEventListener("click", () => { dismiss(); });
			const head = document.createElement("div");
			head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px";
			head.append(title, close);

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

			const saveButton = () => {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "dsha_icon";
				button.setAttribute("aria-label", t("save"));
				button.title = t("save");
				// Quiet on purpose: Enter saves, and the button is only the discoverable alternative.
				button.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;"
					+ "border:0;border-radius:8px;background:transparent;color:inherit;opacity:.5;cursor:pointer";
				button.appendChild(icon("M3.5 8.5 L6.5 11.5 L12.5 4.5", 15));
				return button;
			};
			const commit = () => {
				const comment = collapse(input.value);
				if (comment === "") { input.focus(); return; }
				add(sessionId, read.text, comment, read.range);
				const problem = problems.get(sessionId) ?? "";
				if (problem === "") {
					dismiss();
					// The next Enter sends: the composer already holds this annotation.
					focusComposer();
					return;
				}
				hint.textContent = problem === "no-send" ? t("noSend") : problem;
				hint.style.opacity = "1";
			};
			const save = saveButton();
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
				if (composingEnter({ isComposing: event.isComposing, keyCode: event.keyCode, composing })) return;
				event.preventDefault();
				commit();
			});

			row.append(hint, save);
			card.append(head, input, row);
			editing = sessionId;
			openedAt = Date.now();
			paintActive(read.range);
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
				syncPlaceholder(list.length > 0);
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
				/** The selection text present when the press began, so a plain click is not a new one. */
				let pressSelection = null;
				const onDown = (event) => {
					const action = pressAction({
						inside: event?.target?.closest?.("[data-dsh-annotate]") != null,
						open: editing !== null,
						sinceOpened: Date.now() - openedAt,
					});
					if (action === "ignore") return;
					if (action === "close") { dismiss(); return }
					// The button belongs to the selection that produced it. Pressing anywhere else takes
					// it away now, before the release, so it cannot outlive the highlight.
					pressSelection = String(window.getSelection?.() ?? "");
					dismiss();
				};
				const onUp = (event) => {
					// A press inside this plugin's own UI must not rebuild the layer: it would
					// unmount the editor the same press is opening.
					if (event?.target?.closest?.("[data-dsh-annotate]") != null) return;
					if (editing !== null) return;
					// Only a release that left a *different* selection earns a new button. A click on a
					// table cell, a button, or padding often leaves the old selection untouched, and
					// re-offering it there would resurrect a button the press just removed.
					const current = String(window.getSelection?.() ?? "");
					const wanted = offerAction({
						inside: event?.target?.closest?.("[data-dsh-annotate]") != null,
						open: false,
						pressed: pressSelection,
						current,
					});
					pressSelection = null;
					if (wanted === false) { dismiss(); return }
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
					// The placeholder is not something the person typed.
					const draft = blankDraft(raw) ? "" : String(raw).replaceAll(PLACEHOLDER, "").trim();
					const text = draft === "" ? batch : `${draft}\n\n${batch}`;
					event.preventDefault();
					event.stopPropagation();
					// Handing the message to the composer keeps its attachments and its own clear
					// logic in play; only a build without that button falls back to a bare prompt.
					if (submitThroughComposer(text)) {
						pending.set(sessionId, []);
						problems.delete(sessionId);
						changed();
						return;
					}
					void flush(sessionId, text).then((sent) => {
						if (sent !== true) return;
						inputActions?.setDraft?.("");
					});
				};
				/**
				 * The send button means the same thing as Enter.
				 *
				 * With an annotation waiting the draft holds only a placeholder, so the composer's own
				 * submit would send that and nothing else. Intercepting the click lets one gesture
				 * carry the annotations the way Enter does.
				 */
				const onPrimaryClick = (event) => {
					if (editing !== null) return;
					const button = composerPrimary();
					if (button === null || button === undefined || event.target !== button) return;
					const sessionId = onScreen() ?? [...pending.keys()].find(id => itemsOf(id).length > 0) ?? "";
					const batch = composeBatch(itemsOf(sessionId), t);
					if (!sendable(batch)) return;
					const draft = blankDraft(lastInput?.draft) ? "" : String(lastInput?.draft ?? "").replaceAll(PLACEHOLDER, "").trim();
					const text = draft === "" ? batch : `${draft}\n\n${batch}`;
					event.preventDefault();
					event.stopPropagation();
					if (submitThroughComposer(text)) {
						pending.set(sessionId, []);
						problems.delete(sessionId);
						changed();
					}
				};
				document.addEventListener("click", onPrimaryClick, true);

				// Capture phase: a control that stops propagation on its own mouseup must not be able
				// to leave the button or the card behind.
				document.addEventListener("mousedown", onDown, true);
				document.addEventListener("mouseup", onUp, true);
				document.addEventListener("keydown", onKey);
				document.addEventListener("keydown", onComposerEnter, true);
				window.addEventListener("scroll", onScroll, true);
				return () => {
					document.removeEventListener("click", onPrimaryClick, true);
					document.removeEventListener("mousedown", onDown, true);
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
		exports.blankDraft = blankDraft;
		exports.PLACEHOLDER = PLACEHOLDER;
		exports.readSelection = readSelection;
		exports.annotatableTarget = annotatableTarget;
		exports.pressAction = pressAction;
		exports.focusComposer = focusComposer;
		exports.offerAction = offerAction;
		exports.composingEnter = composingEnter;
		exports.placeMath = placeMath;

		exports.collapse = collapse;
		exports.pending = pending;
		//#endregion

		return module.exports;
	}
});
