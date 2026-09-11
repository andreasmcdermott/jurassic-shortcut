# Nedry rejection portrait

Asset: `public/images/nedry-wag.png`.

Generated with the built-in imagegen tool. The image contains two equal square frames side by side. CSS alternates between them to animate the finger wag. Reduced-motion preferences show the first frame without animation.

The portrait appears only for a rejected API token, HTTP 401, during connection. Other errors use the normal error message. Retry clears the invalid token and returns focus to the token input. Closing the dialog resets the effect. The image is bundled locally and makes no external requests.

## Generation prompt

Use case: illustration-story. Asset type: a two-frame pixel-art sprite sheet for the playful Dennis Nedry invalid-password screen in a Jurassic Park-inspired local web app. Create ONE wide raster image, aspect ratio exactly 2:1, with TWO equal square frames side by side and no gaps. Each square contains the SAME waist-up portrait of Dennis Nedry from Jurassic Park: stocky face, dark short hair, large round glasses, mischievous smile, bright tropical short-sleeve shirt. He faces the viewer and holds one raised index finger beside his face, making the iconic 'ah ah ah' scolding gesture. In the LEFT square the raised finger leans slightly left; in the RIGHT square the finger leans slightly right, with the rest of the portrait perfectly aligned and unchanged, so switching equal frames creates a finger-wag animation. Style: chunky low-resolution early-1990s digitized video portrait, recognizable likeness, crisp pixel clusters and subtle dithering, limited VGA colors. Center both portraits identically, head and finger fully inside each square with generous black margins. Completely flat pure black background in BOTH squares, no border, no scenery, no text, no letters, no logos, no watermark. This is an asset sprite sheet only, not a screenshot of an interface.
