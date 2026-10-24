# Oneday app icon

A folded paper boat sails across calm water toward a rising amber sun. The boat is a raft in the Buddhist sense: something you use to reach the other shore and then leave behind. It stands for the app's wish that one day you no longer need it. Sunlight shines through the sail, so the day the boat is heading for is already visible in it.

The palette continues the earlier sunrise icon: porcelain sky, amber sun, and pale blue water. The iOS assets are opaque and square; the system applies its own corner mask.

| Appearance | Asset | Source |
| --- | --- | --- |
| Default | `AppIcon.png` | `docs/icon/oneday-icon-light.svg` |
| Dark | `AppIcon-Dark.png` | `docs/icon/oneday-icon-dark.svg` |
| Tinted | `AppIcon-Tinted.png` | `docs/icon/oneday-icon-tinted.svg` |

The assets are in `ios/App/Assets.xcassets/AppIcon.appiconset/`. To export an asset after editing its SVG (the tinted asset also needs `-colorspace Gray` after `-`):

```sh
rsvg-convert -w 1024 -h 1024 docs/icon/oneday-icon-light.svg \
  | magick - -alpha off -strip PNG24:ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon.png
```
