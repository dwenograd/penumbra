# Penumbra

A free IES profile editor for lighting artists. Shape a light with a top-down map, editable curves and composited layers, then save a standard `.ies` file.

It runs in your browser with nothing to install, no network use and no engine plugin. Your files stay on your machine.

## Run it
Download the repo and open `index.html` in Chrome, Edge or Firefox. Keep the folder together, because the page loads its files from `js/` and `css/`.

In Chrome and Edge, Save overwrites the same file after you pick it once, which suits reimporting into an engine. In Firefox, each save downloads a new copy.

## Why it exists
I'm a lighting artist, and I wanted an IES tool that goes beyond fixed 10° sliders, two planes and a view from the side, with a preview closer to what you see in the game.

## IES can do more than you think
An IES profile can be asymmetric and hold noise like lens grime, so a beam can carry texture all on its own.

## Features
- **Top-down map:** see the whole light at once, in linear, stops or false colour, with draggable layer handles. The spot's inner and outer cone are marked on the map and the slice, so you can see what is projected while authoring the whole profile.
- **Trace image:** lay a photo of a real beam on a wall, or a drawing, over the map as a guide. It is only a guide: no image data ever goes into the profile.
- **Slice curve:** drag to draw a curve, or type each point's angle, value and sharpness.
- **Composited layers:** Beam, Ring, Lobe, Cutoff, Repeat, Free curve and Imperfection, with blend modes, EV gain, mix, clipping, solo and placement.
- **Adjustment layers:** Curves, Levels and Contrast reshape everything below them.
- **Slider base layer:** C0-180 and C90-270 sliders at 10° steps with %, candela and lux, for anyone coming from slider-based tools.
- **Preview:** First person, Free, Wall, Floor and Side views, with spot cone, inverse-square falloff, a grey or checker room, GGX metal and optional shadows. Free view flies around the room, and you can place and aim the light. Wall, Floor and Free can repeat the light in a row to judge overlap, and a colour temperature tints the preview.
- **Brightness references:** 16 cited real-world lights, from a candle to a stadium pole.
- **Import and export:** open any type C `.ies`, add one as a layer, or load one as the comparison reference. Saved files carry their editable layers, and radially symmetric profiles save as a single plane. The map and preview save as PNG.
- **Share links:** Copy link puts the whole layered profile in a link. Nothing is uploaded; the profile travels inside the link.
- **Session restore:** your profile and view settings come back when you reopen the page, and opening a file or preset is an undo step.

## Limits
- The preview's tonemap is an ACES approximation, with no GI or reflections. Only the test ball casts shadows, and Source radius softens them with an approximation. Use the engine for final judgement.
- Side view brightness is illustrative and scales with Haze.
- Profiles are previewed and saved on a 256 x 256 grid, so very sharp edges soften.
- Layer groups aren't in yet.
- A profile built on an imported file is too large for a share link. Send the `.ies` instead.

## Tests
```bash
node --test test/
```

## License
[MIT](LICENSE).
