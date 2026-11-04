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
- **Top-down map:** see the whole light at once, in linear, stops or false colour, with draggable layer handles.
- **Slice curve:** drag to draw a curve, or type each point's angle, value and sharpness.
- **Composited layers:** Beam, Ring, Lobe, Cutoff, Repeat, Free curve and Imperfection, with blend modes, EV gain, mix, clipping, solo and placement.
- **Slider base layer:** C0-180 and C90-270 sliders at 10° steps with %, candela and lux, for anyone coming from slider-based tools.
- **Preview:** First person, Wall, Floor and Side views, with spot cone, inverse-square falloff, a grey or checker room, and GGX metal.
- **Brightness references:** 16 cited real-world lights, from a candle to a stadium pole.
- **Import and export:** open any type C `.ies`. Saved files carry their editable layers, and radially symmetric profiles save as a single plane.

## Limits
- The preview's tonemap is an ACES approximation, with no shadows, GI or reflections. Use the engine for final judgement.
- Side view brightness is illustrative and scales with Haze.
- Profiles are previewed and saved on a 256 x 256 grid, so very sharp edges soften.
- Layer groups aren't in yet.

## Tests
```bash
node --test test/
```

## License
[MIT](LICENSE).
