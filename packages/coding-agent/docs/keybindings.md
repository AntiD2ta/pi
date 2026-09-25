# Keybindings Reference

Pi exposes named actions, such as `app.session.new`, that can be assigned keybindings. You can change default assignments or bind unassigned actions in Pi's [user configuration](configuration.md#agent-directory).

Run `/hotkeys` to see the active shortcuts for the main editor and application.

## Assign keybindings

Create `<agent-dir>/keybindings.json`. The agent directory defaults to `~/.pi/agent` and is described in [Agent directory](configuration.md#agent-directory).

Map each action identifier to one key or a list of keys:

```json
{
  "app.session.new": "ctrl+shift+n",
  "app.session.tree": ["ctrl+shift+t", "alt+shift+t"]
}
```

A configured value replaces the default for that action. Use an empty list to disable an action's keybindings:

```json
{
  "tui.altScreen.pageUp": []
}
```

After editing the file, run `/reload` to apply the changes to the active session.

## Key syntax

Write a key as `modifier+key`. Modifiers are `ctrl`, `shift`, `alt`, and `super`. You can combine modifiers. Valid keys are:

- **Letters:** `a-z`
- **Digits:** `0-9`
- **Special:** `escape`, `esc`, `enter`, `return`, `tab`, `space`, `backspace`, `delete`, `insert`, `clear`, `home`, `end`, `pageUp`, `pageDown`, `up`, `down`, `left`, `right`
- **Function:** `f1`-`f12`
- **Symbols:** `` ` ``, `-`, `=`, `[`, `]`, `\`, `;`, `'`, `,`, `.`, `/`, `!`, `@`, `#`, `$`, `%`, `^`, `&`, `*`, `(`, `)`, `_`, `+`, `|`, `~`, `{`, `}`, `:`, `<`, `>`, `?`

Examples: `ctrl+shift+x`, `alt+ctrl+x`, `ctrl+shift+alt+x`, `super+k`, `ctrl+super+k`, and `ctrl+1`.

`super` bindings require a terminal that reports the modifier separately, typically through the Kitty keyboard protocol. They may not work in terminals without that support.

## Actions

### Terminal UI

#### Cursor movement

| Keybinding id | Default | Description |
|---|---|---|
| `tui.editor.cursorUp` | `up` | Move cursor up, browsing older history at the top |
| `tui.editor.cursorDown` | `down` | Move cursor down, browsing newer history at the bottom |
| `tui.editor.historyPrevious` | None | Select the previous prompt history entry |
| `tui.editor.historyNext` | None | Select the next prompt history entry |
| `tui.editor.cursorLeft` | `left`, `ctrl+b` | Move cursor left |
| `tui.editor.cursorRight` | `right`, `ctrl+f` | Move cursor right |
| `tui.editor.cursorWordLeft` | `alt+left`, `ctrl+left`, `alt+b` | Move cursor word left |
| `tui.editor.cursorWordRight` | `alt+right`, `ctrl+right`, `alt+f` | Move cursor word right |
| `tui.editor.cursorLineStart` | `home`, `ctrl+home` | Move to line start |
| `tui.editor.cursorLineEnd` | `end`, `ctrl+end`, `ctrl+e` | Move to line end |
| `tui.editor.jumpForward` | `ctrl+]` | Jump forward to character |
| `tui.editor.jumpBackward` | `ctrl+alt+]` | Jump backward to character |
| `tui.editor.pageUp` | `pageUp`, `ctrl+pageUp` | Scroll up by page |
| `tui.editor.pageDown` | `pageDown`, `ctrl+pageDown` | Scroll down by page |

#### Range selection

Selection extends from a stable anchor. Reversing direction moves the active end without moving that anchor. Vertical and page movement use visible wrapped rows; the selected text retains only logical newlines. Repeated Shift+Up at the first row extends to its start; repeated Shift+Down at the last row extends to its end. These actions apply to the built-in multiline editor in regular and fullscreen modes. `Ctrl+A` selects the entire prompt, replacing its former line-start default.

| Keybinding id | Default | Description |
|--------|---------|-------------|
| `tui.editor.selectLeft` | `shift+left` | Select one grapheme left |
| `tui.editor.selectRight` | `shift+right` | Select one grapheme right |
| `tui.editor.selectUp` | `shift+up` | Select one visible row up |
| `tui.editor.selectDown` | `shift+down` | Select one visible row down |
| `tui.editor.selectWordLeft` | `ctrl+shift+left`, `alt+shift+left` | Select one word left |
| `tui.editor.selectWordRight` | `ctrl+shift+right`, `alt+shift+right` | Select one word right |
| `tui.editor.selectLineStart` | `shift+home` | Select to logical line start |
| `tui.editor.selectLineEnd` | `shift+end` | Select to logical line end |
| `tui.editor.selectPageUp` | `shift+pageUp` | Select one page up by visible rows |
| `tui.editor.selectPageDown` | `shift+pageDown` | Select one page down by visible rows |
| `tui.editor.selectDocumentStart` | `ctrl+shift+home` | Select to prompt start |
| `tui.editor.selectDocumentEnd` | `ctrl+shift+end` | Select to prompt end |
| `tui.editor.selectAll` | `ctrl+a` | Select the whole prompt |

User bindings replace each action's defaults. Modified navigation keys work only when the terminal reports their modifiers; legacy terminals may send the same bytes as unmodified keys. No fallback shortcuts are assigned. In tmux, enable extended keys as described in [tmux setup](tmux.md). An application or fullscreen transcript action explicitly bound to the same key may intercept it before the editor receives it.

In fullscreen mode, double-clicking, triple-clicking, or dragging within editor text also creates an editable selection. A drag may start just after a line's last character or end in that editor row's blank space. Drags started farther into blank space, over the transcript, or across component boundaries remain screen-only. In regular mode, the terminal handles mouse selection; use keyboard actions to select editable text. Backspace, Delete, typing, paste, and yank consume the editor range. The configured newline action replaces it with a newline, but Enter submits the whole prompt. Starting selection closes autocomplete and inline completion. Tab clears the selection without deleting text, then completes from the active end. Focus changes and copying leave an unchanged selection in place. Replacing the editor text or submitting clears it.

The dedicated history actions always change history entries, regardless of cursor position in a multiline prompt. Explicit history bindings take precedence over application actions while the main editor is focused, so binding `tui.editor.historyPrevious` to `ctrl+p` overrides model cycling without changing `Ctrl+P` in selectors.

#### Text editing

| Keybinding id | Default | Description |
|---|---|---|
| `tui.editor.deleteCharBackward` | `backspace` | Delete character backward |
| `tui.editor.deleteCharForward` | `delete`, `ctrl+d` | Delete character forward |
| `tui.editor.deleteWordBackward` | `ctrl+w`, `alt+backspace` | Delete word backward |
| `tui.editor.deleteWordForward` | `alt+d`, `alt+delete` | Delete word forward |
| `tui.editor.deleteToLineStart` | `ctrl+u` | Delete to line start |
| `tui.editor.deleteToLineEnd` | `ctrl+k` | Delete to line end |
| `tui.editor.yank` | `ctrl+y` | Paste most recently deleted text |
| `tui.editor.yankPop` | `alt+y` | Cycle through deleted text after yank |
| `tui.editor.undo` | `ctrl+-` (`ctrl+z` on Windows; `alt+z` on WSL) | Undo last edit |

#### Input and selection

| Keybinding id | Default | Description |
|---|---|---|
| `tui.input.cursorLineStart` | `ctrl+a` | Move to start in single-line inputs; the multiline editor uses `tui.editor.selectAll` instead |
| `tui.input.newLine` | `shift+enter`, `ctrl+j` | Insert new line |
| `tui.input.submit` | `enter` | Submit input |
| `tui.input.tab` | `tab` | Tab or autocomplete |
| `tui.input.copy` | `ctrl+c` | Copy selection |
| `tui.select.up` | `up` | Move selection up |
| `tui.select.down` | `down` | Move selection down |
| `tui.select.pageUp` | `pageUp` | Page up in list |
| `tui.select.pageDown` | `pageDown` | Page down in list |
| `tui.select.confirm` | `enter` | Confirm selection |
| `tui.select.cancel` | `escape`, `ctrl+c` | Cancel selection |

#### Fullscreen

In fullscreen mode, these actions control the transcript and take precedence over editor actions using the same key.

| Keybinding id | Default | Description |
|---|---|---|
| `tui.altScreen.pageUp` | `pageUp` | Scroll the transcript up by one page |
| `tui.altScreen.pageDown` | `pageDown` | Scroll the transcript down by one page |
| `tui.altScreen.halfPageUp` | None | Scroll the transcript up by half a page |
| `tui.altScreen.halfPageDown` | None | Scroll the transcript down by half a page |
| `tui.altScreen.lineUp` | None | Scroll the transcript up by one line |
| `tui.altScreen.lineDown` | None | Scroll the transcript down by one line |
| `tui.altScreen.previousPrompt` | `ctrl+shift+up`, `ctrl+up` (`ctrl+up` only on Windows and WSL) | Jump to the previous marked message |
| `tui.altScreen.nextPrompt` | `ctrl+shift+down`, `ctrl+down` (`ctrl+down` only on Windows and WSL) | Jump to the next marked message |
| `tui.altScreen.search` | `ctrl+shift+f` (`ctrl+f` on Windows and WSL) | Search the rendered transcript |
| `tui.altScreen.searchNext` | `enter`, `ctrl+g` | Select the next search match while searching |
| `tui.altScreen.searchPrevious` | `shift+enter`, `ctrl+shift+g` | Select the previous search match while searching |
| `tui.altScreen.searchClose` | `escape` | Close transcript search |
| `tui.altScreen.top` | `home` | Scroll to the beginning of the transcript |
| `tui.altScreen.bottom` | `end` | Scroll to the transcript end and follow new output |

### Application

| Keybinding id | Default | Description |
|--------|---------|-------------|
| `app.interrupt` | `escape` | Cancel / abort |
| `app.clear` | `ctrl+c` | Clear editor (first) / exit (second) |
| `app.exit` | `ctrl+d` | Exit (when editor empty) |
| `app.suspend` | `ctrl+z` (None on Windows) | Suspend to background |
| `app.editor.external` | `ctrl+g` | Open in external editor (`externalEditor`, `$VISUAL`, `$EDITOR`, Notepad on Windows, or `nano` elsewhere) |
| `app.clipboard.pasteImage` | `ctrl+v` (`alt+v` on Windows and WSL) | Paste image or text from clipboard |

On native Windows, `app.suspend` has no default because Windows terminals do not support Unix job control. If you assign it manually, Pi shows a status message instead of suspending. WSL uses the normal `ctrl+z` and `fg` behavior.

### Sessions

| Keybinding id | Default | Description |
|--------|---------|-------------|
| `app.session.new` | None | Start a new session (`/new`) |
| `app.session.tree` | None | Open session tree navigator (`/tree`) |
| `app.session.fork` | None | Fork current session (`/fork`) |
| `app.session.resume` | None | Open session resume picker (`/resume`) |
| `app.session.togglePath` | `ctrl+p` | Toggle path display |
| `app.session.toggleSort` | `ctrl+s` | Toggle sort mode |
| `app.session.toggleNamedFilter` | `ctrl+n` | Toggle named-only filter |
| `app.session.rename` | `ctrl+r` | Rename session |
| `app.session.delete` | `ctrl+d` | Delete session |
| `app.session.deleteNoninvasive` | `ctrl+backspace` | Delete session when query is empty |

### Models and Thinking

| Keybinding id | Default | Description |
|--------|---------|-------------|
| `app.model.select` | `ctrl+l` | Open model selector |
| `app.model.cycleForward` | `ctrl+p` | Cycle to next model |
| `app.model.cycleBackward` | `shift+ctrl+p` (`alt+p` on Windows and WSL) | Cycle to previous model |
| `app.models.save` | `ctrl+s` | Save the selected default model or scoped model configuration to settings |
| `app.thinking.cycle` | `shift+tab` | Cycle thinking level |
| `app.thinking.save` | `ctrl+s` | Save current thinking level to settings |
| `app.thinking.toggle` | `ctrl+t` | Collapse or expand thinking blocks |

### Display and Message Queue

| Keybinding id | Default | Description |
|--------|---------|-------------|
| `app.tools.expand` | `ctrl+o` | Collapse or expand tool output |
| `app.message.copy` | `ctrl+x` | Copy the selected message in `/tree`; in the prompt, copy editable selection first, then an active fullscreen screen selection when `fullscreenCopyOnSelect` is disabled, then the last assistant message |
| `app.message.followUp` | `alt+enter` (`ctrl+q` on Windows and WSL) | Queue follow-up message |
| `app.message.dequeue` | `alt+up` (`alt+q` on Windows and WSL) | Restore queued messages to editor |

Keyboard selection does not copy automatically. Fullscreen mouse copy-on-select remains available. `Ctrl+C` still clears the prompt or exits; `Ctrl+X` is the copy action, not cut.

### Tree Navigation

| Keybinding id | Default | Description |
|--------|---------|-------------|
| `app.tree.foldOrUp` | `ctrl+left`, `alt+left` | Fold current branch segment, or jump to the previous segment start |
| `app.tree.unfoldOrDown` | `ctrl+right`, `alt+right` | Unfold current branch segment, or jump to the next segment start or branch end |
| `app.tree.editLabel` | `shift+l` | Edit the label on the selected tree node |
| `app.tree.toggleLabelTimestamp` | `shift+t` | Toggle label timestamps in the tree |
| `app.tree.filter.default` | `ctrl+d` | Set tree filter to default view |
| `app.tree.filter.noTools` | `ctrl+t` | Toggle tree filter that hides tool results |
| `app.tree.filter.userOnly` | `ctrl+u` | Toggle tree filter that shows only user messages |
| `app.tree.filter.labeledOnly` | `ctrl+l` | Toggle tree filter that shows only labeled entries |
| `app.tree.filter.all` | `ctrl+a` | Toggle tree filter that shows all entries |
| `app.tree.filter.cycleForward` | `ctrl+o` | Cycle tree filter forward |
| `app.tree.filter.cycleBackward` | `shift+ctrl+o` | Cycle tree filter backward |

### Scoped Models Selector

Used inside the scoped models selector (opened via `/scoped-models`).

| Keybinding id | Default | Description |
|--------|---------|-------------|
| `app.models.enableAll` | `ctrl+a` | Enable all models (or all matching the current search) |
| `app.models.clearAll` | `ctrl+x` | Clear all models (or all matching the current search) |
| `app.models.toggleProvider` | `ctrl+p` | Toggle all models for the current provider |
| `app.models.reorderUp` | `alt+up` | Move the selected model up in the cycle order |
| `app.models.reorderDown` | `alt+down` | Move the selected model down in the cycle order |
