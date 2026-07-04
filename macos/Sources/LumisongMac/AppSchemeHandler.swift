import Foundation
import WebKit

final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let rootURL: URL

    override init() {
        guard let resourceURL = Bundle.main.resourceURL else {
            fatalError("Bundle resource URL is unavailable")
        }
        self.rootURL = resourceURL.appendingPathComponent("WebContent", isDirectory: true)
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            fail(urlSchemeTask, code: .badURL)
            return
        }

        let relativePath = sanitizedPath(from: url)
        let fileURL = rootURL.appendingPathComponent(relativePath, isDirectory: false)

        guard fileURL.path.hasPrefix(rootURL.path) else {
            fail(urlSchemeTask, code: .noPermissionsToReadFile)
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": mimeType(for: fileURL.pathExtension),
                    "Content-Length": "\(data.count)",
                    "Access-Control-Allow-Origin": "*",
                ]
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            respond404(urlSchemeTask)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func sanitizedPath(from url: URL) -> String {
        let rawPath = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
        let parts = rawPath
            .split(separator: "/")
            .filter { !$0.isEmpty && $0 != "." && $0 != ".." }
        return parts.joined(separator: "/")
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "wasm": return "application/wasm"
        case "wav": return "audio/wav"
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/mp4"
        case "ogg": return "audio/ogg"
        case "ico": return "image/x-icon"
        default: return "application/octet-stream"
        }
    }

    private func fail(_ task: WKURLSchemeTask, code: URLError.Code) {
        task.didFailWithError(NSError(domain: NSURLErrorDomain, code: code.rawValue))
    }

    private func respond404(_ task: WKURLSchemeTask) {
        let response = HTTPURLResponse(
            url: task.request.url ?? URL(string: "app://app/index.html")!,
            statusCode: 404,
            httpVersion: "HTTP/1.1",
            headerFields: nil
        )!
        task.didReceive(response)
        task.didFinish()
    }
}
