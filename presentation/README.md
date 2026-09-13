# Rate Limiting — slide deck

HTML slides for a talk about rate limiting: the five algorithms, where a rate limiter sits in a system, and why retries need jitter.

## View online

The deck is deployed to this repo's GitHub Pages every time someone pushes to `main`.

## Run locally

You **must open the deck over HTTP**. Double-clicking `index.html` will not work.

```bash
cd presentation
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

You can also use the **Live Server** extension in VS Code, or `npx serve presentation`.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `→` `Space` `Enter` `PageDown` / click | Next step |
| `←` `Backspace` `PageUp` | Previous step |
| `Home` / `End` | First / last slide |
| `N` | Show or hide speaker notes |
| `O` | See all slides (click one to jump to it) |
| `T` | Switch light / dark theme |
| `F` | Full screen |
| `Esc` | Close the all-slides view and the notes |
