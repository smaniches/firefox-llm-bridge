# AMO Screenshots

AMO accepts up to **10 screenshots** at **1280 × 800 px** (PNG).

## Shot list (in order)

1. **`01-sidebar-chat.png`** — sidebar open on a real page, with a chat-mode
   exchange demonstrating "summarize this page". Page should be something
   recognizable but uncontroversial (Wikipedia, MDN, GitHub repo home).

2. **`02-agent-tools.png`** — sidebar mid-agent-loop, showing a sequence
   of tool calls (read_page → click_element → type_text → task_complete)
   with the per-tool icons visible.

3. **`03-streaming.png`** — assistant message streaming in, with the
   blinking caret visible at the end of the partial text. Optional: a
   visible cost counter in the status bar.

4. **`04-tool-preview.png`** — the TOOL_PREVIEW modal overlay showing
   tool name + formatted JSON input + Approve / Cancel buttons.

5. **`05-policy-warning.png`** — sidebar with a POLICY_WARNING amber
   banner near the top, listing matched heuristic patterns.

6. **`06-options-providers.png`** — Options page showing the four
   provider cards (Ollama, Anthropic, OpenAI, Google), with Ollama
   highlighted as active.

7. **`07-options-safety.png`** — Options page Safety Policy section
   with the allowlist, blocklist, preview-mode select, and the
   injection-warning checkbox.

8. **`08-vision.png`** — agent using `screenshot_for_vision` on a page
   the accessibility tree can't describe well (e.g. a canvas chart),
   followed by an assistant response that interpreted the image.

## Capture process

1. Launch a fresh Firefox profile: `npm run dev`.
2. Set the OS display to 1280 × 800 (or use Firefox's responsive design
   mode for the sidebar).
3. Use `about:debugging` to confirm the extension version matches the
   release.
4. Take screenshots with the OS tool. Save as PNG, ≤ 1 MB each.
5. Drop them into this directory with the exact filenames above.
6. Upload to AMO during submission; the listing form lets you reorder.

## Branding constraints

- No real API keys visible. Use sk-ant-XXXXXXXX placeholders.
- No personal data on visible pages.
- No copyrighted UI (third-party brand pages should be plain content).
- The Firefox UI chrome should look like a recent Firefox release.

## Updating screenshots

Re-shoot whenever:

- Sidebar header/footer layout changes.
- New tools added (update `02-agent-tools.png`).
- New Options sections added.
- Policy / preview UI redesigned.
