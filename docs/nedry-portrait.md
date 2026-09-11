# Nedry rejection portrait

The active sprite is `public/images/nedry-wag-original-style.png`. It follows the movie reference with an oversized digitized head and a small cartoon body. See [the generation and refinement prompts](nedry-original-style.md).

The previous Hawaiian-shirt portrait remains unchanged at `public/images/nedry-wag.png`. Its original prompt is preserved in [the backup notes](nedry-portrait-backup.md). To switch back, change the `.nedry-portrait` background image in `src/style.css` to `/images/nedry-wag.png`.

Both assets were created with the built-in imagegen tool. Each contains two equal square frames. The existing CSS animation alternates between them; reduced-motion preferences show a still frame.
