# Revvd realism assets

Every file here is hosted on this site; the game makes no requests to Poly Haven. All are CC0 (public domain):
https://polyhaven.com/license

## Race soil (dirt-*.webp)

Brown Mud 02 by Rob Tuytel, Poly Haven. CC0.
Source: https://polyhaven.com/a/brown_mud_02
1K diffuse, OpenGL normal and ARM (ambient occlusion / roughness / metalness) maps, converted to WebP. Colour is
sRGB; normal and ARM are linear data. Used on the Desert Dunes and Forest Mud race tracks (race-realism.js).

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
