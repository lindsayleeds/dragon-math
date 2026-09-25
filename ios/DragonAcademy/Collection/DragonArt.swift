import API
import Store
import SwiftUI
import Sync
import UIKit

/// The bundled dragon art: `dragon-<id>` in Assets.xcassets/Dragons, made from
/// the web's public/dragon_pngs by `npm run ios:dragon-art`
/// (scripts/ios-dragon-art/dragonArt.js holds the sizes).
enum DragonArt {
    /// The largest a dragon is drawn, in points. The bundled bitmaps are 3×
    /// this, so drawing one bigger would blur it; change DRAGON_ART_MAX_POINTS
    /// in the script with it.
    static let maxPoints: CGFloat = 120

    static func imageName(_ dragonID: Int) -> String { "dragon-\(dragonID)" }

    /// Whether the app has this dragon's art. A dragon added to the catalog
    /// after this build doesn't; its art downloads after a content sync
    /// (`DownloadedDragonArt`).
    static func isBundled(_ dragonID: Int) -> Bool {
        UIImage(named: imageName(dragonID)) != nil
    }
}

/// The art of dragons added to the catalog after this build (#143), downloaded
/// into Application Support by Sync's `DragonArtDownloader` after each content
/// check, and read back for `DragonArtView`. Observable, so a Den or reveal
/// on screen when a download lands redraws with it.
@MainActor @Observable
final class DownloadedDragonArt {
    private let files: DragonArtFiles
    private let downloader: DragonArtDownloader
    /// Bumped when files land, so views that read an image redraw.
    private var revision = 0
    /// Decoded images, and the ids known to have no file, so a redraw doesn't
    /// touch the disk.
    @ObservationIgnored private var images: [Int: UIImage] = [:]
    @ObservationIgnored private var missing: Set<Int> = []

    init(files: DragonArtFiles, source: any DragonArtSource) {
        self.files = files
        downloader = DragonArtDownloader(files: files, source: source, isBundled: { DragonArt.isBundled($0) })
    }

    /// The app's copy: Application Support/DragonArt, served by `client`.
    static func live(client: DragonAPIClient) -> DownloadedDragonArt {
        let files = (try? DragonArtFiles.applicationDefault())
            ?? DragonArtFiles(directory: FileManager.default.temporaryDirectory.appending(path: "DragonArt"))
        return DownloadedDragonArt(files: files, source: APIDragonArtSource(client: client))
    }

    /// The downloaded art for a dragon the app doesn't bundle, or nil.
    func image(for dragonID: Int) -> UIImage? {
        _ = revision
        if let image = images[dragonID] { return image }
        if missing.contains(dragonID) { return nil }
        guard let url = files.cachedURL(for: dragonID),
              let image = UIImage(contentsOfFile: url.path(percentEncoded: false))
        else {
            missing.insert(dragonID)
            return nil
        }
        // The server's PNG is the web's full-size one; keep a bitmap no bigger
        // than the bundled art's.
        let side = DragonArt.maxPoints * 3
        let scale = min(1, side / max(image.size.width, image.size.height, 1))
        let fitted = image.preparingThumbnail(of: CGSize(width: image.size.width * scale, height: image.size.height * scale))
            ?? image
        images[dragonID] = fitted
        return fitted
    }

    /// Downloads the art of any new dragon in the synced catalog. The files
    /// already right aren't fetched again, and a failed one is tried again on
    /// the next call.
    func update(from store: any Store) async {
        guard let catalog = try? await store.cachedContent(.dragonCatalog) else { return }
        let report = await downloader.update(from: catalog)
        guard !report.downloaded.isEmpty else { return }
        for id in report.downloaded {
            images[id] = nil
            missing.remove(id)
        }
        revision += 1
    }

    /// Follows `sync`: updates the art from the catalog already on the device
    /// (retrying last launch's failures; the launch sync may finish before
    /// this subscribes), then after every run that checked content (the app
    /// coming back, the network returning, a sign-in). Runs until the task is
    /// cancelled.
    func follow(_ sync: SyncEngine, store: any Store) async {
        let reports = await sync.reports()
        await update(from: store)
        for await report in reports where report.content == .checked {
            await update(from: store)
        }
    }
}

/// A dragon's art, scaled to fit its frame (keep that frame within
/// `DragonArt.maxPoints`): the bundled art, else the downloaded copy of a
/// dragon added since this build, else a dragon glyph. Decorative: callers
/// label the card it sits on.
struct DragonArtView: View {
    let dragonID: Int
    @Environment(\.downloadedDragonArt) private var downloaded

    var body: some View {
        Group {
            if DragonArt.isBundled(dragonID) {
                Image(DragonArt.imageName(dragonID))
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
            } else if let image = downloaded?.image(for: dragonID) {
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
            } else {
                Text(verbatim: "🐉")
                    .font(.system(size: 200))
                    .minimumScaleFactor(0.05)
                    .lineLimit(1)
            }
        }
        .accessibilityHidden(true)
    }
}

extension EnvironmentValues {
    /// Art downloaded for dragons added since this build; nil (the glyph) in
    /// previews and tests that don't set one.
    @Entry var downloadedDragonArt: DownloadedDragonArt? = nil
}
