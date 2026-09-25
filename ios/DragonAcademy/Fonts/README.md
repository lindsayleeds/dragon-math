# Bundled fonts

The kid screens draw in the font theme the kid picks in Settings
(`FontTheme`, generated from src/data/fontThemes.js by
`npm run ios:font-themes`). The theme's families are bundled from this folder.

**Status: the font files are not in the repo yet.** Until they are, each
family draws in the closest font iOS ships (`FontFamily` in
FontFamilies.swift: Noteworthy, Arial Rounded, Avenir, Chalkboard SE), and the
registration test skips it.

## Adding the files

Download each file below, unmodified, from the Google Fonts repo into this
folder (keep the exact filename, brackets included), then

    cd ios && xcodegen generate

and commit the fonts with the regenerated project. Info.plist already lists
every file under `UIAppFonts`, and `FontRegistrationTests` checks that each
bundled family's PostScript names resolve — if a name there is wrong for a
variable font's instance, fix it in FontFamilies.swift.

| Family | File | Weights used | PostScript names | Download | License |
| --- | --- | --- | --- | --- | --- |
| Caveat | `Caveat[wght].ttf` | 400, 700 (variable 400–700) | Caveat-Regular, Caveat-Bold | https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf | OFL-1.1 |
| Patrick Hand | `PatrickHand-Regular.ttf` | 400 | PatrickHand-Regular | https://github.com/google/fonts/raw/main/ofl/patrickhand/PatrickHand-Regular.ttf | OFL-1.1 |
| Fredoka | `Fredoka[wdth,wght].ttf` | 400, 700 (variable 300–700) | Fredoka-Regular, Fredoka-Bold | https://github.com/google/fonts/raw/main/ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf | OFL-1.1 |
| Nunito | `Nunito[wght].ttf` | 400, 700 (variable 200–1000) | Nunito-Regular, Nunito-Bold | https://github.com/google/fonts/raw/main/ofl/nunito/Nunito%5Bwght%5D.ttf | OFL-1.1 |
| Baloo 2 | `Baloo2[wght].ttf` | 400, 700 (variable 400–800) | Baloo2-Regular, Baloo2-Bold | https://github.com/google/fonts/raw/main/ofl/baloo2/Baloo2%5Bwght%5D.ttf | OFL-1.1 |
| Quicksand | `Quicksand[wght].ttf` | 400, 700 (variable 300–700) | Quicksand-Regular, Quicksand-Bold | https://github.com/google/fonts/raw/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf | OFL-1.1 (Reserved Font Name “Quicksand”) |
| Comic Neue | `ComicNeue-Regular.ttf` | 400 | ComicNeue-Regular | https://github.com/google/fonts/raw/main/ofl/comicneue/ComicNeue-Regular.ttf | OFL-1.1 |
| Comic Neue | `ComicNeue-Bold.ttf` | 700 | ComicNeue-Bold | https://github.com/google/fonts/raw/main/ofl/comicneue/ComicNeue-Bold.ttf | OFL-1.1 |

Italic files (Nunito-Italic, ComicNeue-*Italic, ComicNeue-Light) aren't
needed: the app draws no italics. LICENSES.md has each family's copyright and
the full OFL text; keep it with the files.

A theme added on the web with a family not listed here won't compile
(FontThemeCatalog.swift names families as `FontFamily` statics): add the
family to FontFamilies.swift, this table, LICENSES.md and `UIAppFonts`.
