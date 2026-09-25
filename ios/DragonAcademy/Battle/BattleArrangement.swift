import CoreGraphics
import SwiftUI

/// How the battle screen lays itself out for the space it has. IOS_PLAN.md:
/// iPhone is portrait only, iPad runs in both orientations plus Split View and
/// Stage Manager, and the battle is designed iPad-landscape first.
///
/// Size classes alone can't tell iPad landscape from iPad portrait (both are
/// regular × regular), so the container's shape decides between the two
/// regular-width arrangements.
enum BattleArrangement: Equatable {
    /// iPad landscape (or a wide Stage Manager window): the scoreboard and
    /// companion panels in a column beside the problem and grid.
    case sideBySide
    /// iPad portrait and the wider Split View / Stage Manager widths: one
    /// column, full-size type.
    case stacked
    /// iPhone portrait and the narrow iPad widths (Slide Over, a third of a
    /// Split View): one column, tighter type and spacing.
    case compact

    /// The narrowest width that gets the full-size type when no size class is
    /// known. A compact size class always gets `.compact`.
    static let compactWidthBelow: CGFloat = 500
    /// Side by side needs room for the panel column and a grid of 44pt cells.
    static let sideBySideMinWidth: CGFloat = 800
    /// …and a landscape-shaped container.
    static let sideBySideMinAspect: CGFloat = 1.2

    static func forContainer(horizontalSizeClass: UserInterfaceSizeClass?, size: CGSize) -> Self {
        if horizontalSizeClass == .compact || size.width < compactWidthBelow {
            return .compact
        }
        if size.width >= sideBySideMinWidth, size.width >= size.height * sideBySideMinAspect {
            return .sideBySide
        }
        return .stacked
    }

    var isCompact: Bool { self == .compact }
}

/// The size of one grid cell and the gap between cells for a grid of
/// `cols` × `rows` in `available` space. Cells are square, grow to fill the
/// space up to `maxSide`, and never shrink below `minSide` (the 44pt minimum
/// tap target); a grid that doesn't fit at the minimum overflows and the
/// caller scrolls it.
struct BattleGridMetrics: Equatable {
    var side: CGFloat
    var gap: CGFloat

    static let minSide: CGFloat = 44
    static let maxSide: CGFloat = 120
    /// The gap is tighter when the cells are small, so a 7-wide grid still
    /// fits a 375pt iPhone at the minimum size.
    static let gap: CGFloat = 8
    static let tightGap: CGFloat = 4
    static let tightBelowSide: CGFloat = 60

    init(side: CGFloat, gap: CGFloat) {
        self.side = side
        self.gap = gap
    }

    init(cols: Int, rows: Int, available: CGSize) {
        let cols = max(cols, 1)
        let rows = max(rows, 1)
        func fit(gap: CGFloat) -> CGFloat {
            min(
                (available.width - gap * CGFloat(cols - 1)) / CGFloat(cols),
                (available.height - gap * CGFloat(rows - 1)) / CGFloat(rows),
                Self.maxSide)
        }
        var gap = Self.gap
        var side = fit(gap: gap)
        if side < Self.tightBelowSide {
            gap = Self.tightGap
            side = fit(gap: gap)
        }
        self.init(side: max(Self.minSide, side.rounded(.down)), gap: gap)
    }

    func size(cols: Int, rows: Int) -> CGSize {
        let cols = CGFloat(max(cols, 1))
        let rows = CGFloat(max(rows, 1))
        return CGSize(width: side * cols + gap * (cols - 1), height: side * rows + gap * (rows - 1))
    }
}
