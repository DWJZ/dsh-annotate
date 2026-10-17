---
description: "dsh-annotate: select a passage of an answer, leave a comment per selection, and send the whole set at once."
---

# dsh-annotate

English | [中文](README.zh.md)

Select a passage of an answer, write what you think about it; annotate as many passages as you like, then send them together.

## What it does

- Select text in an answer and a small **Annotate** button appears next to the selection; open it and write the comment for that passage. **Enter saves, Shift+Enter breaks the line**, and the button and card each animate in and out briefly.
- Annotate as often as you like, each one independent: its own quote, its own comment.
- **Enter in the composer sends the waiting annotations with it**: the draft first, the annotation batch after it, as one message — and with an empty box, the annotations go on their own. Shift+Enter still breaks the line and sends nothing.
- The annotations wait as **chips in a row above the composer**, each showing its quote and comment and removable on its own. There is no send button — **Enter in the composer sends**.
- Enter composes them into one numbered message after your draft:

  ```
  Please address each of my annotations on your answer above:

  1. Quote: "this step overwrites the original file"
     Comment: it should back it up first

  2. Quote: "about 3 seconds"
     Comment: where does that number come from?
  ```

- Highlighting is best effort: while the selected ranges are still valid they are painted with the CSS Custom Highlight API, and a re-render drops the paint — the list, not the paint, is the record.

**Not** message anchoring and **not** persistence: the quoted text travels inside the message, so the next turn sees it and so does anyone reading the Session later, while the list itself lives in browser memory and is gone after a reload.

## Install

```sh
# from GitHub
dsh plugin --profile web add github:DWJZ/dsh-annotate

# local development (the profile links the checkout, so edits apply on restart)
dsh plugin --profile web add link:/path/to/dsh-annotate
```

The Desktop application's `desktop` profile is added through its own plugin manager.

## Use

1. Select a passage of an answer.
2. Press **Annotate**, write the comment, press **Save**. Repeat 1–2.
3. Press Enter in the composer (with or without words of your own).

## Known limitations

- **The host half is only a registration row.** The client graph is composed by scanning the Loader's entries for packages declaring `dsh.client`, so without that row the `client/` half is never loaded. It registers nothing else.
- Annotations **do not persist**: a page reload loses them (the quotes are in the message you sent, so no context is lost).
- Highlights **do not survive a re-render**, which streaming output or a Session switch can cause; the list stays complete.
- Annotating while an answer is still streaming works, but the paint may drift off the passage as the text reflows.

## Test

```sh
npm test
```

Pure functions (message composition, line flattening) plus a mounted-dock case against a fake React: what the composed message says and how it is laid out, adding/removing/clearing the list, and that sending happens exactly once.

## License

MIT
