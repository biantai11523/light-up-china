import UIKit
import WebKit

// This app lives only on the CI simulator. Serve the production bundle over
// loopback so the real iOS web process, worker and graphics stack are exercised.
@main final class Host: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let web = WKWebView()
        let controller = UIViewController()
        controller.view = web
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        self.window = window
        window.makeKeyAndVisible()
        guard let address = CommandLine.arguments.last, let url = URL(string: address),
              url.host == "127.0.0.1" else { return false }
        web.load(URLRequest(url: url))
        return true
    }
}
