# Revvd realism assets

Every file here is hosted on this site; the game makes no requests to Poly Haven. All are CC0 (public domain):
https://polyhaven.com/license

## Race track ground (race/*.jpg)

All CC0, from Poly Haven's 1K JPG maps: the colour (diffuse, sRGB) at 1024 px, and the OpenGL normal and ARM (ambient
occlusion / roughness / metalness) maps scaled to 512 px (linear data). Used for the race tracks' ground
(race-look.js), blended by distance from the track's middle:
- Sand 01 by Rob Tuytel: https://polyhaven.com/a/sand_01 (Desert Dunes, off the track)
- Gravelly Sand by Dario Barresi: https://polyhaven.com/a/gravelly_sand (Desert Dunes, the riding surface)
- Forest Leaves 02 by Rob Tuytel: https://polyhaven.com/a/forest_leaves_02 (Forest Mud, off the track)
- Mud Forest by eye-candy.xyz: https://polyhaven.com/a/mud_forest (Forest Mud, the riding surface)
- Snow 02 by Rob Tuytel: https://polyhaven.com/a/snow_02 (Snow Ridge, both: packed finer and bluer on the track)

## Race track plants (public/models/nature/didelta.glb, succulents.glb)

Didelta Spinosa by Jenelle van Heerden (https://polyhaven.com/a/didelta_spinosa) and Cheiridopsis Succulent by James
Ray Cock and Jenelle van Heerden (https://polyhaven.com/a/cheiridopsis_succulent), Poly Haven, CC0. The 1K glTF
models packed by tools/pack_nature.py (made much lighter; the succulent's flowers left out). Used on Desert Dunes with
the open worlds' quiver trees, boulders and rooibos (models/nature/wild).

## Red soil (soil-*.webp)

Red Laterite Soil Stones by Amal Kumar, Poly Haven. CC0.
Source: https://polyhaven.com/a/red_laterite_soil_stones
From the 2K JPG maps: soil-color (diffuse), soil-normal (OpenGL normal), and soil-orh, which packs ambient occlusion
(R), roughness (G) and the displacement height (B) into one picture. Each at 2048 px (high quality) and 1024 px
(-1k: medium and phones), WebP. Used for Jungle Ridge MX's track and cut banks (look.js, open-world/materials.mjs).

## Grassy ground (grass-*.webp)

Sparse Grass by Amal Kumar, Poly Haven. CC0.
Source: https://polyhaven.com/a/sparse_grass
From the 2K JPG maps: grass-color (diffuse, brought to a khaki-olive average and a touch less saturated) and
grass-height (displacement), each scaled to 1024 px and tiled 2 x 2 into a 2048 px WebP. Used for the grassy ground
of Jungle Ridge MX (its world file's look.photo.grass; open-world/materials.mjs).

## Sky light (sky-clear-1k.hdr)

Kloofendal 43d Clear Pure Sky by Greg Zaal, Poly Haven. CC0.
Source: https://polyhaven.com/a/kloofendal_43d_clear_puresky
The 1K Radiance HDR file, unchanged. The game clips its sun out when it loads it and uses the rest as the soft light
of a blue sky on clear days (look.js).

## Ridge trees (public/models/nature/acacias.glb)

Made with ez-tree by Daniel Greenheck (MIT, https://github.com/dgreenheck/ez-tree), with its own oak bark and oak leaf
textures: its 'Oak Large' preset reshaped into flat-topped, acacia-style umbrella trees (a tall bare trunk, long limbs
rising in a V, leaves only out at the tips), a detailed and a simple far version of three trees, packed by
tools/pack_trees.py (the settings are in its notes). Used for the lone trees on the ridges of Jungle Ridge MX
(open-world/mx-dress.mjs).

## The other worlds' ground (redsand-, sand-, pineground-, leafground-, autumnleaves-, ash-, darkrock-, muddy-, slate-*.webp)

All from Poly Haven, CC0, from the 2K JPG maps, packed like the red soil above (colour, OpenGL normal, and orh =
ambient occlusion / roughness / displacement height; 2048 px and -1k 1024 px, WebP), by a small Pillow script:
- redsand: "Red Sand" by Rohit Seervi (https://polyhaven.com/a/red_sand): Redrock Frontier, Canyon Run, Sheerwall Mesa.
- sand: "Dense Sand" by Dimitrios Savva (https://polyhaven.com/a/dense_sand): Golden Dunes.
- pineground: "Forest Ground 04" by Rob Tuytel and Rico Cilliers (https://polyhaven.com/a/forest_ground_04): Pinecrest,
  and the Timber, Fog and Midnight Chutes' forest floor.
- leafground: "Forest Leaves 02" by Rob Tuytel (https://polyhaven.com/a/forest_leaves_02): Wildwood and Tag Wood.
- autumnleaves: "Forest Leaves 04" by Rob Tuytel (https://polyhaven.com/a/forest_leaves_04): Autumn Ridge and the
  Autumn Chute.
- muddy: "Muddy Tracks" by Amal Kumar (https://polyhaven.com/a/muddy_tracks): the Storm Chute (packed the same way, in
  headless Chrome's WebP encoder).
- slate: "Rock Ground 02" by Rob Tuytel (https://polyhaven.com/a/rock_ground_02): Slatefall's line and rocky banks
  (packed the same way).
- ash: "Burned Ground 01" by Rob Tuytel (https://polyhaven.com/a/burned_ground_01): Magma Isle.
- darkrock (colour and a grey height picture only, 2048 px): "Dark Rock" by Amal Kumar (https://polyhaven.com/a/dark_rock):
  Magma Isle's rock (its look.photo.rock).
Each world's json says how it's used (look.soil, look.photo).

