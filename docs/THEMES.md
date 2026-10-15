# Themes

Settings → Appearance offers 192 bundled palettes: ListFlow, Catppuccin Mocha/Latte, Dracula, Tycho, 20 other Omarchy stock palettes and 167 other community palettes. Search by name and filter light/dark. Theme changes apply immediately, persist on this device, update other open tabs, work offline, and update the browser theme-color. ListFlow restores the original appearance; unknown saved IDs fall back to it. Preferences are intentionally per device, not synchronized workspace commitments.

The UI uses palette-derived backgrounds, surfaces, borders, text, accents and status colors. Text and button colors are adjusted for contrast, so these are ListFlow adaptations rather than copies of entire desktop themes. The drawing canvas stays white and imported images retain their original colors.

Palette sources:

- [Omarchy stock themes](https://github.com/omacom/omarchy/tree/quattro/themes)
- [Omarchy community registry](https://github.com/omacom/omarchy-theme-registry), with each entry linked to its author repository in the app
- [Tycho by Leonardo Betti](https://github.com/leonardobetti/omarchy-tycho)
- [Dracula by catlee](https://github.com/catlee/omarchy-dracula-theme)

Only color values and attribution metadata are bundled. No desktop configuration, code, fonts or wallpapers are installed or fetched at runtime. Community registry metadata is MIT licensed; its notice is in licenses/omarchy-theme-registry-MIT.txt. The bundled collection is a snapshot, not a live marketplace. Refresh with `python3 scripts/import-omarchy-themes.py`; the script reads JSON and TOML and does not execute theme code. It also reads locally installed stock palettes from /usr/share/omarchy/themes without editing them.
