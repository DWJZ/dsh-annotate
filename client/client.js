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
				".dsha_button{position:absolute;z-index:2147483000;display:flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--dsw-alias-border-secondary);border-radius:8px;background:var(--dsw-alias-bg-elevated);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.6;box-shadow:0 4px 16px rgb(0 0 0 / 18%);cursor:pointer}",
				".dsha_card{position:absolute;z-index:2147483001;display:flex;flex-direction:column;gap:8px;width:320px;padding:12px;border:1px solid var(--dsw-alias-border-secondary);border-radius:12px;background:var(--dsw-alias-bg-elevated);box-shadow:0 8px 28px rgb(0 0 0 / 22%)}",
				".dsha_quote{max-height:72px;overflow:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;white-space:pre-wrap}",
				".dsha_input{width:100%;min-height:64px;resize:vertical;padding:8px;border:1px solid var(--dsw-alias-border-secondary);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
				".dsha_row{display:flex;align-items:center;gap:8px;justify-content:flex-end}",
				".dsha_dock{display:flex;flex-direction:column;gap:8px;padding:8px 0;font-size:13px;color:var(--dsw-alias-label-primary)}",
				".dsha_head{display:flex;align-items:center;justify-content:space-between;color:var(--dsw-alias-label-secondary)}",
				".dsha_item{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border:1px solid var(--dsw-alias-border-secondary);border-radius:8px}",
				".dsha_item_text{display:flex;flex-direction:column;gap:2px;min-width:0}",
				".dsha_item_quote{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}",
				".dsha_item_comment{color:var(--dsw-alias-label-primary)}",
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
			save: "保存",
			cancel: "取消",
			dockTitle: "待发送的标注（{count}）",
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
			save: "Save",
			cancel: "Cancel",
			dockTitle: "Annotations to send ({count})",
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

		const itemsOf = (sessionId) => pending.get(sessionId) ?? [];

		/** Redraw every dock that is showing a waiting list. */
		function changed() {
			for (const watcher of watchers) watcher();
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

		/** The layer that holds this plugin's floating UI, created on first use. */
		function layerOf() {
			if (layer !== null) return layer;
			layer = document.createElement("div");
			layer.setAttribute("data-dsh-annotate", "layer");
			document.body.appendChild(layer);
			return layer;
		}

		/** Remove the floating UI without touching the waiting list. */
		function dismiss() {
			editing = null;
			if (layer !== null) layer.textContent = "";
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
			if (element !== null && element.closest?.("[data-dsh-annotate]") !== null) return undefined;
			const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : undefined;
			return { text, range };
		}

		/**
		 * Place one floating element against a range, keeping it inside the viewport.
		 * @param element - the element to place.
		 * @param rect - the range's rectangle.
		 */
		function place(element, rect) {
			layerOf().appendChild(element);
			const width = 320;
			const left = Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - width - 12));
			element.style.left = `${String(left)}px`;
			element.style.top = `${String(rect.bottom + window.scrollY + 8)}px`;
		}

		/**
		 * Offer the annotate button for the current selection.
		 * @param ctx - the client plugin context.
		 * @param sessionId - the Session on screen, when one is.
		 */
		function offer(ctx, sessionId, t) {
			const read = readSelection(window.getSelection());
			if (read === undefined || sessionId === undefined) { dismiss(); return; }
			const rect = read.range?.getBoundingClientRect();
			if (rect === undefined || (rect.width === 0 && rect.height === 0)) { dismiss(); return; }
			dismiss();
			const button = document.createElement("button");
			button.type = "button";
			button.className = "dsha_button";
			button.textContent = t("annotate");
			button.addEventListener("click", (event) => {
				event.preventDefault();
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
			dismiss();
			const rect = read.range?.getBoundingClientRect();
			const card = document.createElement("div");
			card.className = "dsha_card";
			const quote = document.createElement("div");
			quote.className = "dsha_quote";
			quote.textContent = read.text;
			const input = document.createElement("textarea");
			input.className = "dsha_input";
			input.placeholder = t("placeholder");
			const row = document.createElement("div");
			row.className = "dsha_row";
			const cancel = document.createElement("button");
			cancel.type = "button";
			cancel.textContent = t("cancel");
			cancel.addEventListener("click", () => { dismiss(); });
			const save = document.createElement("button");
			save.type = "button";
			save.textContent = t("save");
			save.addEventListener("click", () => {
				const comment = collapse(input.value);
				if (comment === "") return;
				add(sessionId, read.text, comment, read.range);
				dismiss();
			});
			row.append(cancel, save);
			card.append(quote, input, row);
			editing = sessionId;
			if (rect !== undefined) place(card, rect);
			input.focus();
		}
		//#endregion

		//#region dock
		/**
		 * The list above the composer: what waits, and one button that sends it all.
		 * @param props - the slot's props, plus the Session this dock belongs to and the send it may use.
		 * @returns the dock element, or null while nothing waits.
		 */
		function AnnotateDock({ t, sessionId, send }) {
			const [, redraw] = React.useState(0);
			React.useEffect(() => {
				const watcher = () => { redraw((value) => value + 1) };
				watchers.add(watcher);
				return () => { watchers.delete(watcher) };
			}, []);
			const items = itemsOf(sessionId);
			const notice = React.useState("");
			const [message, setMessage] = notice;
			if (items.length === 0) return null;

			const remove = (position) => {
				const list = itemsOf(sessionId).slice();
				list.splice(position, 1);
				pending.set(sessionId, list);
				changed();
			};
			const clear = () => { pending.set(sessionId, []); changed(); };
			const sendAll = () => {
				const text = composeBatch(itemsOf(sessionId), t);
				if (!sendable(text)) return;
				if (typeof send !== "function") { setMessage(t("noSend")); return; }
				Promise.resolve(send(text)).then(() => {
					pending.set(sessionId, []);
					changed();
				}).catch((failure) => { setMessage(String(failure?.message ?? failure)) });
			};

			return React.createElement("div", { className: "dsha_dock" },
				React.createElement("div", { className: "dsha_head" },
					React.createElement("span", null, t("dockTitle", { count: items.length })),
					React.createElement("span", { className: "dsha_row" },
						React.createElement("button", { type: "button", onClick: clear }, t("clear")),
						React.createElement("button", { type: "button", onClick: sendAll }, t("sendAll")))),
				...items.map((item, position) => React.createElement("div", { className: "dsha_item", key: `${String(position)}-${item.quote.slice(0, 12)}` },
					React.createElement("div", { className: "dsha_item_text dsha_grow" },
						React.createElement("div", { className: "dsha_item_quote" }, item.quote),
						React.createElement("div", { className: "dsha_item_comment" }, item.comment)),
					React.createElement("button", { type: "button", onClick: () => { remove(position) } }, t("remove")))),
				message === "" ? null : React.createElement("div", { className: "dsha_item_quote" }, message));
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
				const onUp = () => { offer(ctx, onScreen(), t) };
				const onKey = (event) => { if (event.key === "Escape") dismiss() };
				const onScroll = () => { if (editing === null) dismiss() };
				document.addEventListener("mouseup", onUp);
				document.addEventListener("keydown", onKey);
				window.addEventListener("scroll", onScroll, true);
				return () => {
					document.removeEventListener("mouseup", onUp);
					document.removeEventListener("keydown", onKey);
					window.removeEventListener("scroll", onScroll, true);
					if (layer !== null) { layer.remove(); layer = null }
				};
			}, "dsh-annotate: selection affordance");

			ctx.slots.inject("conversation.input.dock", (dockCtx) => {
				const dispose = ctx.slots.register({
					name: "conversation.input.dock",
					id: "annotate",
					order: 5,
					locale: NS,
				}, (props) => AnnotateDock({
					...props,
					sessionId: onScreen() ?? "",
					send: (text) => dockCtx.uiConversation.send(text),
				}));
				return () => { dispose() };
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		// Pure helpers, exported so the suite can pin the message it composes.
		exports.composeBatch = composeBatch;
		exports.collapse = collapse;
		exports.pending = pending;
		//#endregion

		return module.exports;
	}
});
