import SafariServices
import SwiftUI

/// The parent view's row for the full web dashboard (#153): detailed stats,
/// custom spelling lists and billing stay on the web (ADR 0002). It sits in
/// the parent view, so it's already behind the parental gate and device check.
/// Opens in an in-app Safari sheet so the parent comes straight back.
struct WebDashboardLink: View {
    var url: URL = AppConfiguration.webDashboardURL

    @State private var showing = false

    var body: some View {
        Button {
            showing = true
        } label: {
            Label("Full dashboard on the web", systemImage: "safari")
        }
        .accessibilityHint(Text("Opens the Dragon Math parent dashboard in Safari."))
        .accessibilityIdentifier("parentHome.webDashboard")
        .sheet(isPresented: $showing) {
            SafariView(url: url)
                .ignoresSafeArea()
        }
    }
}

private struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
