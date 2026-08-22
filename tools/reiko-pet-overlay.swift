#!/usr/bin/env swift

import AppKit
import WebKit

private let compactOverlaySize = NSSize(width: 300, height: 280)
private let expandedOverlaySize = NSSize(width: 840, height: 230)
private let allowedHosts = Set(["127.0.0.1", "localhost"])
private let overlayPositionKey = "reiko-pet-overlay-position-v1"

private func clampedOverlaySize(_ requested: NSSize, visibleFrame: NSRect?) -> NSSize {
  guard let visibleFrame else { return requested }
  return NSSize(
    width: max(1, min(requested.width, visibleFrame.width)),
    height: max(1, min(requested.height, visibleFrame.height))
  )
}

private enum RoamPhase {
  case travel
  case observe
}

final class DragSurfaceView: NSView {
  var onDragBegan: (() -> Void)?
  var onDragEnded: ((Bool) -> Void)?
  var onClick: (() -> Void)?

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func mouseDown(with event: NSEvent) {
    guard let window else { return }
    let start = window.frame.origin
    onDragBegan?()
    window.performDrag(with: event)
    let end = window.frame.origin
    let moved = hypot(end.x - start.x, end.y - start.y) >= 3
    onDragEnded?(moved)
    if !moved {
      onClick?()
    }
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .openHand)
  }
}

final class ReikoOverlayDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
  private var panel: NSPanel?
  private var webView: WKWebView?
  private var roamButton: NSButton?
  private var squadButton: NSButton?
  private var loadDeadline: Timer?
  private var roamTimer: Timer?
  private var isSquadExpanded = false
  private var isSafeDemo = false
  private var roamingEnabled = true
  private var runtimeRoamingAllowed = false
  private var isDragging = false
  private var isProgrammaticRoamMove = false
  private var suppressPositionSave = false
  private var roamDirection: CGFloat = -1
  private var roamPhase = RoamPhase.observe
  private var roamPhaseUntil = Date.distantPast
  private var roamCycle = 0
  private var availableSquadCount = 1
  private var lastReportedRoaming: (active: Bool, direction: Int)?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let controller = WKUserContentController()
    controller.add(self, name: "reikoOverlay")

    let configuration = WKWebViewConfiguration()
    configuration.userContentController = controller

    let webView = WKWebView(
      frame: NSRect(origin: .zero, size: compactOverlaySize),
      configuration: configuration
    )
    webView.navigationDelegate = self
    webView.autoresizingMask = [.width, .height]
    webView.setValue(false, forKey: "drawsBackground")

    let contentView = NSView(frame: webView.frame)
    contentView.autoresizingMask = [.width, .height]
    contentView.wantsLayer = true
    contentView.layer?.backgroundColor = NSColor.clear.cgColor
    contentView.addSubview(webView)

    let dragSurface = DragSurfaceView(frame: contentView.bounds)
    dragSurface.autoresizingMask = [.width, .height]
    dragSurface.onDragBegan = { [weak self] in self?.beginManualDrag() }
    dragSurface.onDragEnded = { [weak self] moved in self?.finishManualDrag(moved: moved) }
    dragSurface.onClick = { [weak self] in self?.handlePetClick() }
    contentView.addSubview(dragSurface, positioned: .above, relativeTo: webView)

    let roamButton = makeControlButton(
      title: "Ⅱ",
      action: #selector(toggleRoaming),
      accessibilityLabel: "Pause Reiko roaming"
    )
    roamButton.frame = NSRect(
      x: compactOverlaySize.width - 108,
      y: compactOverlaySize.height - 36,
      width: 28,
      height: 28
    )
    roamButton.toolTip = "Pause Reiko roaming"
    contentView.addSubview(roamButton, positioned: .above, relativeTo: dragSurface)

    let squadButton = makeControlButton(
      title: "1",
      action: #selector(toggleSquad),
      accessibilityLabel: "Show Reiko agents"
    )
    squadButton.frame = NSRect(
      x: compactOverlaySize.width - 72,
      y: compactOverlaySize.height - 36,
      width: 28,
      height: 28
    )
    squadButton.toolTip = "Show Reiko agents"
    squadButton.isHidden = true
    contentView.addSubview(squadButton, positioned: .above, relativeTo: dragSurface)

    let closeButton = makeControlButton(
      title: "×",
      action: #selector(closeOverlay),
      accessibilityLabel: "Close Reiko agent overlay"
    )
    closeButton.frame = NSRect(
      x: compactOverlaySize.width - 36,
      y: compactOverlaySize.height - 36,
      width: 28,
      height: 28
    )
    closeButton.toolTip = "Close Reiko agent overlay"
    contentView.addSubview(closeButton, positioned: .above, relativeTo: dragSurface)

    let panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: compactOverlaySize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.isMovableByWindowBackground = true
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.delegate = self
    panel.contentView = contentView

    if let screen = NSScreen.main {
      let visible = screen.visibleFrame
      let defaultCenter = NSPoint(
        x: visible.maxX - compactOverlaySize.width / 2 - 24,
        y: visible.minY + compactOverlaySize.height / 2 + 24
      )
      let center = restoredCenter() ?? defaultCenter
      panel.setFrame(clampedFrame(center: center, size: compactOverlaySize), display: false)
    }

    self.panel = panel
    self.webView = webView
    self.roamButton = roamButton
    self.squadButton = squadButton
    updateRoamButton()

    guard let url = overlayURL() else {
      fputs("Invalid Reiko overlay URL. Use a loopback http URL.\n", stderr)
      NSApplication.shared.terminate(nil)
      return
    }

    webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    loadDeadline = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { _ in
      fputs("Reiko overlay timed out while loading the local page.\n", stderr)
      NSApplication.shared.terminate(nil)
    }
    panel.orderFrontRegardless()
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "reikoOverlay" else { return }
    if let action = message.body as? String {
      handleBridgeAction(action)
      return
    }
    guard
      let payload = message.body as? [String: Any],
      let action = payload["action"] as? String
    else {
      return
    }
    if action == "setSquadCount", let count = payload["count"] as? NSNumber {
      setSquadCount(
        count.intValue,
        demo: payload["demo"] as? Bool ?? false,
        roamingAllowed: payload["roamingAllowed"] as? Bool ?? false
      )
    } else {
      handleBridgeAction(action)
    }
  }

  private func handleBridgeAction(_ action: String) {
    if action == "ready" {
      loadDeadline?.invalidate()
      loadDeadline = nil
      startRoaming()
    } else if action == "close" {
      closeOverlay()
    }
  }

  private func makeControlButton(
    title: String,
    action: Selector,
    accessibilityLabel: String
  ) -> NSButton {
    let button = NSButton(title: title, target: self, action: action)
    button.autoresizingMask = [.minXMargin, .minYMargin]
    button.isBordered = false
    button.wantsLayer = true
    button.layer?.backgroundColor = NSColor(
      calibratedRed: 0.08,
      green: 0.055,
      blue: 0.04,
      alpha: 0.92
    ).cgColor
    button.layer?.borderColor = NSColor(calibratedWhite: 1, alpha: 0.28).cgColor
    button.layer?.borderWidth = 1
    button.layer?.cornerRadius = 14
    button.layer?.zPosition = 10
    button.contentTintColor = .white
    button.font = NSFont.systemFont(ofSize: title == "×" ? 17 : 12, weight: .semibold)
    button.setAccessibilityLabel(accessibilityLabel)
    return button
  }

  private func startRoaming() {
    guard roamTimer == nil else { return }
    enterObserve(duration: 1.2)
    roamTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) {
      [weak self] _ in
      self?.stepRoaming()
    }
  }

  @objc private func toggleRoaming() {
    guard runtimeRoamingAllowed else { return }
    roamingEnabled.toggle()
    if roamingEnabled {
      enterObserve(duration: 0.8)
    } else {
      reportWebRoaming(active: false)
    }

    updateRoamButton()
  }

  private func updateRoamButton() {
    guard let roamButton else { return }
    if !runtimeRoamingAllowed {
      let label = "Roaming paused while Reiko works"
      roamButton.title = "●"
      roamButton.isEnabled = false
      roamButton.toolTip = label
      roamButton.setAccessibilityLabel(label)
      return
    }

    let label = roamingEnabled ? "Pause Reiko roaming" : "Resume Reiko roaming"
    roamButton.title = roamingEnabled ? "Ⅱ" : "▶"
    roamButton.isEnabled = true
    roamButton.toolTip = label
    roamButton.setAccessibilityLabel(label)
  }

  private func beginManualDrag() {
    isDragging = true
    reportWebRoaming(active: false)
  }

  private func finishManualDrag(moved: Bool) {
    isDragging = false
    if moved, let panel {
      persistCenter(for: panel)
      enterObserve(duration: 1.15, reaction: "startled")
    }
  }

  private func handlePetClick() {
    guard !isSquadExpanded else { return }
    enterObserve(duration: 1.4, reaction: "wave")
  }

  private func enterObserve(
    at now: Date = Date(),
    duration: TimeInterval? = nil,
    reaction: String? = nil
  ) {
    let observeDurations: [TimeInterval] = [2.2, 2.8, 1.9]
    roamPhase = .observe
    roamPhaseUntil = now.addingTimeInterval(
      duration ?? observeDurations[roamCycle % observeDurations.count]
    )
    reportWebRoaming(active: false)
    if let reaction {
      reportWebReaction(reaction)
    }
  }

  private func enterTravel(at now: Date = Date()) {
    let travelDurations: [TimeInterval] = [4.8, 5.6, 4.2]
    roamPhase = .travel
    roamPhaseUntil = now.addingTimeInterval(
      travelDurations[roamCycle % travelDurations.count]
    )
  }

  private func stepRoaming() {
    guard let panel else { return }
    guard
      roamingEnabled,
      runtimeRoamingAllowed,
      !isSquadExpanded,
      !isDragging,
      !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
      let visible = (panel.screen ?? NSScreen.main)?.visibleFrame
    else {
      reportWebRoaming(active: false)
      return
    }

    let now = Date()
    if now >= roamPhaseUntil {
      if roamPhase == .travel {
        roamCycle += 1
        let reaction = roamCycle % 3 == 0 ? "wave" : nil
        enterObserve(at: now, reaction: reaction)
      } else {
        enterTravel(at: now)
      }
    }

    guard roamPhase == .travel else {
      reportWebRoaming(active: false)
      return
    }

    let minX = visible.minX
    let maxX = max(minX, visible.maxX - panel.frame.width)
    var origin = panel.frame.origin
    let nextX = origin.x + roamDirection * 0.9

    if nextX <= minX || nextX >= maxX {
      origin.x = min(max(nextX, minX), maxX)
      isProgrammaticRoamMove = true
      panel.setFrameOrigin(origin)
      isProgrammaticRoamMove = false
      roamDirection *= -1
      roamCycle += 1
      let reaction = roamCycle % 3 == 0 ? "wave" : nil
      enterObserve(at: now, duration: 2.0, reaction: reaction)
      return
    }

    origin.x = nextX
    isProgrammaticRoamMove = true
    panel.setFrameOrigin(origin)
    isProgrammaticRoamMove = false
    reportWebRoaming(active: true)
  }

  private func reportWebRoaming(active: Bool) {
    let direction = roamDirection < 0 ? -1 : 1
    if let last = lastReportedRoaming,
       last.active == active,
       last.direction == direction {
      return
    }

    lastReportedRoaming = (active, direction)
    let activeLiteral = active ? "true" : "false"
    let script = "window.dispatchEvent(new CustomEvent('reiko-overlay-roaming',{detail:{active:\(activeLiteral),direction:\(direction)}}));"
    webView?.evaluateJavaScript(script)
  }

  private func reportWebReaction(_ kind: String) {
    guard kind == "wave" || kind == "startled" else { return }
    let script = "window.dispatchEvent(new CustomEvent('reiko-overlay-react',{detail:{kind:'\(kind)'}}));"
    webView?.evaluateJavaScript(script)
  }

  private func setSquadCount(_ rawCount: Int, demo: Bool, roamingAllowed: Bool) {
    isSafeDemo = demo
    availableSquadCount = min(6, max(1, rawCount))
    runtimeRoamingAllowed = roamingAllowed && availableSquadCount == 1
    if !runtimeRoamingAllowed {
      reportWebRoaming(active: false)
    }
    updateRoamButton()
    squadButton?.isHidden = availableSquadCount <= 1
    if availableSquadCount <= 1 && isSquadExpanded {
      setSquadExpanded(false)
      return
    }
    updateSquadButton()
  }

  @objc private func toggleSquad() {
    guard availableSquadCount > 1 else { return }
    setSquadExpanded(!isSquadExpanded)
  }

  private func setSquadExpanded(_ expanded: Bool) {
    guard let panel else { return }
    let screen = panel.screen ?? NSScreen.main
    let canShowSquad = (screen?.visibleFrame.width ?? expandedOverlaySize.width) >= 520
    isSquadExpanded = expanded && canShowSquad
    reportWebRoaming(active: false)
    let requestedSize = isSquadExpanded ? expandedOverlaySize : compactOverlaySize
    let size = clampedOverlaySize(requestedSize, visibleFrame: screen?.visibleFrame)
    let center = NSPoint(x: panel.frame.midX, y: panel.frame.midY)
    suppressPositionSave = true
    panel.setFrame(
      clampedFrame(center: center, size: size),
      display: true,
      animate: !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    )
    suppressPositionSave = false

    if !isSquadExpanded {
      enterObserve(duration: 0.8)
    }
    updateSquadButton()
    persistCenter(for: panel)
  }

  private func updateSquadButton() {
    squadButton?.title = isSquadExpanded ? "1" : "\(availableSquadCount)"
    let qualifier = isSafeDemo ? "simulated" : "live"
    let label = isSquadExpanded
      ? "Show one \(qualifier) Reiko agent"
      : "Show \(availableSquadCount) \(qualifier) Reiko agents"
    squadButton?.toolTip = label
    squadButton?.setAccessibilityLabel(label)
  }

  func windowDidMove(_ notification: Notification) {
    guard
      !suppressPositionSave,
      !isProgrammaticRoamMove,
      !isDragging,
      !roamingEnabled,
      let panel
    else {
      return
    }
    persistCenter(for: panel)
  }

  private func persistCenter(for panel: NSPanel) {
    UserDefaults.standard.set(
      [
        "x": Double(panel.frame.midX),
        "y": Double(panel.frame.midY)
      ],
      forKey: overlayPositionKey
    )
  }

  private func restoredCenter() -> NSPoint? {
    guard
      let saved = UserDefaults.standard.dictionary(forKey: overlayPositionKey),
      let x = saved["x"] as? Double,
      let y = saved["y"] as? Double,
      x.isFinite,
      y.isFinite
    else {
      return nil
    }

    return NSPoint(x: x, y: y)
  }

  private func clampedFrame(center: NSPoint, size: NSSize) -> NSRect {
    let screen = NSScreen.screens.first(where: { $0.visibleFrame.contains(center) }) ?? NSScreen.main
    guard let visible = screen?.visibleFrame else {
      return NSRect(
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
        width: size.width,
        height: size.height
      )
    }

    let safeSize = clampedOverlaySize(size, visibleFrame: visible)
    let maxX = max(visible.minX, visible.maxX - safeSize.width)
    let maxY = max(visible.minY, visible.maxY - safeSize.height)
    let origin = NSPoint(
      x: min(max(center.x - safeSize.width / 2, visible.minX), maxX),
      y: min(max(center.y - safeSize.height / 2, visible.minY), maxY)
    )
    return NSRect(origin: origin, size: safeSize)
  }

  @objc private func closeOverlay() {
    loadDeadline?.invalidate()
    roamTimer?.invalidate()
    if let panel {
      persistCenter(for: panel)
    }
    NSApplication.shared.terminate(nil)
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    loadDeadline?.invalidate()
    fputs("Reiko overlay failed to load: \(error.localizedDescription)\n", stderr)
    NSApplication.shared.terminate(nil)
  }

  func webView(
    _ webView: WKWebView,
    didFail navigation: WKNavigation!,
    withError error: Error
  ) {
    loadDeadline?.invalidate()
    fputs("Reiko overlay navigation failed: \(error.localizedDescription)\n", stderr)
    NSApplication.shared.terminate(nil)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard
      let url = navigationAction.request.url,
      url.scheme == "http",
      let host = url.host,
      allowedHosts.contains(host),
      url.path == "/pet-overlay.html"
    else {
      decisionHandler(.cancel)
      return
    }

    decisionHandler(.allow)
  }

  private func overlayURL() -> URL? {
    let requested = CommandLine.arguments.dropFirst().first
      ?? "http://127.0.0.1:4317/pet-overlay.html"
    guard
      let url = URL(string: requested),
      url.scheme == "http",
      let host = url.host,
      allowedHosts.contains(host),
      url.path == "/pet-overlay.html"
    else {
      return nil
    }
    return url
  }
}

let application = NSApplication.shared
let delegate = ReikoOverlayDelegate()
application.setActivationPolicy(.accessory)
application.delegate = delegate
application.run()
