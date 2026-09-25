import SwiftUI

/// Decorative motion that respects Reduce Motion (#168). Game feedback that
/// carries meaning (a cell turning rose, a score moving on) still changes, but
/// the flourish on top (bobbing, wiggles, pops, shakes, slides) is dropped for
/// a plain fade or no animation at all.
enum MotionSafe {
    /// `animation`, or `fallback` (no animation by default) under Reduce
    /// Motion.
    static func animation(_ animation: Animation?, reduceMotion: Bool, fallback: Animation? = nil) -> Animation? {
        reduceMotion ? fallback : animation
    }

    /// `transition`, or a plain fade under Reduce Motion.
    static func transition(_ transition: AnyTransition, reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : transition
    }

    /// Runs `body` with `animation`, or without animating under Reduce Motion.
    @MainActor
    static func withAnimation(_ animation: Animation?, reduceMotion: Bool, _ body: () -> Void) {
        if reduceMotion {
            body()
        } else {
            SwiftUI.withAnimation(animation, body)
        }
    }
}

private struct MotionSafeAnimation<Value: Equatable>: ViewModifier {
    let animation: Animation?
    let fallback: Animation?
    let value: Value
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(MotionSafe.animation(animation, reduceMotion: reduceMotion, fallback: fallback), value: value)
    }
}

private struct MotionSafeTransition: ViewModifier {
    let transition: AnyTransition
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.transition(MotionSafe.transition(transition, reduceMotion: reduceMotion))
    }
}

extension View {
    /// `.animation(_:value:)` for decorative motion: under Reduce Motion it
    /// uses `fallback` instead (none by default; pass a short `.easeOut` to
    /// keep a fade).
    func motionSafeAnimation<V: Equatable>(_ animation: Animation?, fallback: Animation? = nil, value: V) -> some View {
        modifier(MotionSafeAnimation(animation: animation, fallback: fallback, value: value))
    }

    /// `.transition(_:)` that becomes a plain fade under Reduce Motion.
    func motionSafeTransition(_ transition: AnyTransition) -> some View {
        modifier(MotionSafeTransition(transition: transition))
    }
}
