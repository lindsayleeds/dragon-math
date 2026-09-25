@preconcurrency import AVFoundation
import SwiftUI
import UIKit

/// Whether a scanner can run.
enum CodeScannerStatus: Equatable, Sendable {
    case ready
    /// The camera permission was refused (or restricted, e.g. by Screen Time).
    case denied
    /// No camera, e.g. the simulator.
    case unavailable
}

/// Reads QR codes, behind a protocol so the scan flow can be tested with a
/// fake. The live one is ``CameraCodeScanner``.
@MainActor
protocol CodeScanner: AnyObject {
    /// Asks for the camera the first time; says whether scanning can start.
    func prepare() async -> CodeScannerStatus
    /// Starts reading; each QR code's text goes to `onCode`, as often as the
    /// camera sees it.
    func start(onCode: @escaping @MainActor (String) -> Void)
    func stop()
    /// What the camera sees, for the scan screen.
    func makePreviewView() -> UIView
}

/// The scan screen's state: runs a ``CodeScanner`` and passes each distinct
/// code it reads to `onCode` once (the camera reports the same code many
/// times a second).
@MainActor
@Observable
final class CodeScanModel {
    enum Status: Equatable {
        case starting
        case scanning
        case denied
        case unavailable
    }

    private(set) var status: Status = .starting
    let scanner: any CodeScanner
    private let onCode: @MainActor (String) async -> Void
    private var lastCode: String?

    init(scanner: any CodeScanner, onCode: @escaping @MainActor (String) async -> Void) {
        self.scanner = scanner
        self.onCode = onCode
    }

    func start() async {
        guard status == .starting else { return }
        switch await scanner.prepare() {
        case .ready:
            status = .scanning
            scanner.start { [weak self] code in self?.read(code) }
        case .denied:
            status = .denied
        case .unavailable:
            status = .unavailable
        }
    }

    func stop() {
        scanner.stop()
    }

    private func read(_ code: String) {
        guard status == .scanning, code != lastCode else { return }
        lastCode = code
        Task { await onCode(code) }
    }
}

/// The camera, through `AVCaptureMetadataOutput` (every iPad and iPhone with
/// a camera; VisionKit's DataScanner needs newer chips and adds nothing for a
/// QR code). Frames stay on the device and nothing is saved.
@MainActor
final class CameraCodeScanner: NSObject, CodeScanner {
    private let session = AVCaptureSession()
    /// `startRunning()` blocks, so it and `stopRunning()` run here.
    private let sessionQueue = DispatchQueue(label: "dev.placeholder.dragonacademy.code-scanner")
    private var configured = false
    private var onCode: (@MainActor (String) -> Void)?

    func prepare() async -> CodeScannerStatus {
        guard AVCaptureDevice.default(for: .video) != nil else { return .unavailable }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else { return .denied }
        default:
            return .denied
        }
        return configure() ? .ready : .unavailable
    }

    private func configure() -> Bool {
        if configured { return true }
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera)
        else { return false }
        let output = AVCaptureMetadataOutput()
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        guard session.canAddInput(input), session.canAddOutput(output) else { return false }
        session.addInput(input)
        session.addOutput(output)
        // Types are only settable once the output is on the session.
        guard output.availableMetadataObjectTypes.contains(.qr) else { return false }
        output.metadataObjectTypes = [.qr]
        output.setMetadataObjectsDelegate(self, queue: .main)
        configured = true
        return true
    }

    func start(onCode: @escaping @MainActor (String) -> Void) {
        self.onCode = onCode
        nonisolated(unsafe) let session = session
        sessionQueue.async { if !session.isRunning { session.startRunning() } }
    }

    func stop() {
        onCode = nil
        nonisolated(unsafe) let session = session
        sessionQueue.async { if session.isRunning { session.stopRunning() } }
    }

    func makePreviewView() -> UIView {
        let view = CameraPreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }
}

extension CameraCodeScanner: AVCaptureMetadataOutputObjectsDelegate {
    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        let codes = metadataObjects.compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
        // The delegate queue is the main queue (configure()).
        MainActor.assumeIsolated {
            for code in codes { onCode?(code) }
        }
    }
}

/// A view whose layer is the camera preview, so it follows the view's size.
private final class CameraPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

/// Reads whatever it's told to, with no camera: tests, previews and the fakes.
@MainActor
final class FakeCodeScanner: CodeScanner {
    var status: CodeScannerStatus
    private(set) var isRunning = false
    private var onCode: (@MainActor (String) -> Void)?

    init(status: CodeScannerStatus = .ready) { self.status = status }

    func prepare() async -> CodeScannerStatus { status }

    func start(onCode: @escaping @MainActor (String) -> Void) {
        self.onCode = onCode
        isRunning = true
    }

    func stop() {
        onCode = nil
        isRunning = false
    }

    /// The camera "sees" a code.
    func show(_ code: String) {
        onCode?(code)
    }

    func makePreviewView() -> UIView {
        let view = UIView()
        view.backgroundColor = .darkGray
        return view
    }
}

/// Hosts a scanner's camera preview in SwiftUI.
struct CodeScannerPreview: UIViewRepresentable {
    let scanner: any CodeScanner

    func makeUIView(context: Context) -> UIView { scanner.makePreviewView() }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

extension EnvironmentValues {
    /// Makes the scanner for "I have a login code": the camera in the app,
    /// a fake in previews and tests.
    @Entry var makeCodeScanner: @MainActor @Sendable () -> any CodeScanner = { FakeCodeScanner() }
}
