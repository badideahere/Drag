# Car artwork

**The game works right now without any files in this folder.** If a PNG is
missing, `js/game/carart.js` draws the car procedurally: a real side-profile
silhouette with shaded paint, glass, reflections, arches, a ground shadow and
rotating wheels. Those placeholders are not stand-ins for missing features —
they are a finished rendering path, and several of the cars honestly look
better in them than a mediocre PNG would.

Dropping a PNG in here upgrades the visuals. Nothing else changes.

---

## How to add artwork

1. Generate or draw the image (brief below).
2. Save it as a **transparent PNG** named exactly after the car's `id`:

   ```
   assets/cars/corso_hatch.png
   assets/cars/vector_350.png
   assets/cars/kestrel_gtx.png
   assets/cars/ronin_rs.png
   assets/cars/brute_454.png
   assets/cars/apex_v10.png
   assets/cars/vandal_sc.png
   assets/cars/prowler_ps.png
   ```

3. Open `js/data/cars.js`, find that car, and check its `art.wheels` block:

   ```js
   art: {
     lengthPx: 400,        // native width of your PNG's car body
     wheels: {
       frontX: 0.215,      // front axle centre, as a fraction of image width
       rearX:  0.805,      // rear axle centre
       radius: 0.148,      // wheel radius, as a fraction of image width
       rearRadius: 0.148,
     },
   }
   ```

   The wheels are drawn by the engine, not baked into the image, because they
   have to spin at the real wheel speed and blur at the real road speed. So the
   image should show the car **with empty wheel arches** if you can manage it,
   or with wheels that the drawn ones will sit exactly on top of. Line
   `frontX`, `rearX` and `radius` up with your image and it will be seamless.

4. Reload the page. That is all — there is no build step and no asset manifest.

---

## The brief

All eight vehicles are **original fictional designs**. Do not use, reference by
name, or reproduce any real manufacturer's car, badge, grille or promotional
photograph. That is both a legal matter and the reason the cars have their own
identities in the first place.

**Every image must be:**

- **Perfect side profile.** Camera exactly perpendicular to the car, at roughly
  wheel-centre height. No three-quarter angle, no perspective, no tilt. All
  eight cars must share the same camera setup so they look like a set.
- **Facing left**, i.e. the nose on the left of the frame. (`carart.js` mirrors
  if it needs to, but consistency in the source files saves confusion.)
- **Transparent background.** No ground, no shadow, no backdrop, no reflection
  plane — the game draws its own shadow onto the real track surface.
- **Photorealistic**, in the sense of a studio product shot: correct
  proportions, believable panel gaps, real glass with reflections and a slight
  green tint, paint with a specular highlight along the shoulder line and a
  darker sill, visible tyre sidewall detail and brake components behind the
  spokes.
- **Correct stance.** Ride height and rake should match a car set up for the
  strip: level to slightly nose-up, wheels filling the arches.
- **Clean.** No text, no watermark, no signature, no logo, no licence plate, no
  number, no sponsor decal, no motion blur, no lens flare.
- **Not stylised.** Not cartoon, not anime, not toy-like, not low-poly, not a
  diagram, not a blueprint, not cel-shaded.
- Around **1600 px wide** and cropped tightly to the bodywork.

---

## Prompts

These are written for a general image generator. Adjust the wording to suit
whichever tool you use; the constraints at the end of each one are the part that
matters.

The shared suffix — paste it after every prompt below:

> Perfect orthographic side profile view, camera perpendicular to the car at
> wheel centre height, car facing left, fully transparent background, no ground
> or shadow, photorealistic studio automotive render, accurate proportions,
> realistic glass with reflections, realistic tyre sidewall and brake detail,
> clean paint with specular highlight, no text, no watermark, no logos, no
> licence plate, not cartoon, not stylised.

**corso_hatch — Corso 1.8 Sport** ($4,500, 143 hp, FWD, class D)
> A small early-2000s three-door compact hatchback in metallic mid-blue.
> Modest 15-inch alloy wheels, narrow tyres, plastic wheel-arch trim, a small
> roof spoiler, slightly tall ride height. Honest, cheap, unmodified.

**vector_350 — Vector 350 GT** ($28,500, 339 hp, RWD, class C)
> A modern rear-drive V8 muscle coupé in graphite grey. Long bonnet with a
> subtle power bulge, short rear deck, wide rear haunches, five-spoke 18-inch
> wheels, dual exhaust exits, a discreet lip spoiler.

**kestrel_gtx — Kestrel GT-X** ($34,000, 305 hp, AWD turbo, class C)
> A boxy all-wheel-drive turbocharged rally-bred sports saloon in deep blue.
> Bonnet scoop, large rear wing, gold-finished multi-spoke 17-inch wheels,
> functional front bumper vents, slightly raised rally stance.

**ronin_rs — Ronin RS-2** ($62,000, 427 hp, RWD turbo, class B)
> A lightweight Japanese-inspired rear-drive turbo coupé in pearl white. Low
> pop-up-era wedge profile, wide bolt-on arches, deep front splitter, large
> intercooler visible through the bumper, bronze 18-inch wheels, stripped-out
> race stance.

**brute_454 — Brute 454 SS** ($78,000, 483 hp, RWD, class B)
> A 1970s American big-block muscle car in matte black with a red pinstripe.
> Long bonnet with a tall cowl-induction scoop, chrome bumpers, fat rear tyres
> on chrome five-spoke wheels, side exhaust, heavy nose-high drag rake.

**apex_v10 — Apex 610 V10** ($215,000, 612 hp, RWD, class A)
> A mid-engined European V10 supercar in bright yellow. Extremely low, wide and
> wedge-shaped, side intake scoops ahead of the rear wheels, engine cover with
> louvres, low-profile tyres on dark 20-inch wheels, active rear spoiler
> retracted.

**vandal_sc — Vandal SC-720** ($178,000, 790 hp, supercharged RWD, class A)
> A modern supercharged V8 muscle coupé in metallic dark red. Aggressive front
> splitter, large bonnet bulge housing the supercharger, quad exhaust, wide
> rear tyres on black 20-inch wheels, low aggressive stance.

**prowler_ps — Prowler Pro-Street** ($480,000, 1,254 hp, twin-turbo RWD, class S)
> A purpose-built pro-street drag car in bare carbon fibre and gunmetal. Tube
> chassis visible through a stripped interior, huge rear drag slicks with tall
> sidewalls, narrow skinny front runners, wheelie bar at the rear, parachute
> pack on the rear panel, enormous bonnet scoop, roll cage visible through the
> window opening.

---

## A note on wheels

If your generator insists on drawing wheels (most will), that is fine — set
`art.wheels.frontX`, `rearX` and `radius` so the engine's drawn wheels land
exactly on top of them. The engine's wheels are drawn over the image, so as
long as the positions and radius match, the result reads correctly and the
wheels spin properly.

If you can produce a version with empty arches, use it — the result is cleaner
and the suspension travel animation looks better.
