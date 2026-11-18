"""Compare two built map bundles in the same disposable iPhone simulator."""
import functools
import http.server
import json
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
OUT = Path("artifacts/ios").resolve()
OUT.mkdir(parents=True, exist_ok=True)
BUNDLE = "org.lightupchina.GlobeCheck"


def call(*args, timeout=180):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()


def select_phone():
    devices = json.loads(call("xcrun", "simctl", "list", "devices", "available", "-j"))["devices"]
    for runtime, phones in sorted(devices.items(), reverse=True):
        if ".iOS-" not in runtime:
            continue
        for phone in phones:
            if phone["name"] == "iPhone 17 Pro" and phone.get("isAvailable"):
                return phone["udid"], runtime
    runtimes = json.loads(call("xcrun", "simctl", "list", "runtimes", "-j"))["runtimes"]
    ios = sorted((r for r in runtimes if r.get("isAvailable") and ".iOS-26-" in r["identifier"]),
                 key=lambda r: r["version"], reverse=True)
    if not ios:
        raise RuntimeError("The selected Xcode image has no available iOS 26 simulator")
    runtime = ios[0]["identifier"]
    return call("xcrun", "simctl", "create", "GlobeCheck", "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro", runtime), runtime


def install_host(tmp, phone):
    app = tmp / "GlobeCheck.app"
    app.mkdir()
    info = dict(CFBundleIdentifier=BUNDLE, CFBundleName="GlobeCheck", CFBundleExecutable="GlobeCheck",
                CFBundlePackageType="APPL", CFBundleVersion="1", CFBundleShortVersionString="1.0",
                MinimumOSVersion="17.0", UIDeviceFamily=[1], UILaunchScreen={},
                CFBundleSupportedPlatforms=["iPhoneSimulator"], CADisableMinimumFrameDurationOnPhone=True,
                NSAppTransportSecurity=dict(NSAllowsLocalNetworking=True))
    (app / "Info.plist").write_bytes(plistlib.dumps(info))
    sdk = call("xcrun", "--sdk", "iphonesimulator", "--show-sdk-path")
    call("xcrun", "--sdk", "iphonesimulator", "swiftc", "-parse-as-library", "-O", "-sdk", sdk,
         "-target", f"{platform.machine()}-apple-ios17.0-simulator", str(HERE / "Host.swift"),
         "-o", str(app / "GlobeCheck"))
    call("codesign", "--force", "--sign", "-", str(app))
    call("xcrun", "simctl", "install", phone, str(app))


def main():
    phone, runtime = select_phone()
    print("iPhone 17 Pro", runtime, flush=True)
    call("xcrun", "simctl", "bootstatus", phone, "-b", timeout=420)
    with tempfile.TemporaryDirectory() as folder:
        tmp = Path(folder)
        install_host(tmp, phone)
        shutil.copy(HERE / "scenarios.js", tmp / "qa.js")
        done = {case: threading.Event() for case in ["baseline", "candidate"]}
        reports = {}
        for case, src in zip(done, sys.argv[1:], strict=True):
            dist = shutil.copytree(src, tmp / case)
            index = dist / "index.html"
            index.write_text(index.read_text().replace("<head>", '<head><script src="/qa.js"></script>'))

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                case = urlsplit(self.path).path.removeprefix("/result/")
                if case not in done:
                    self.send_error(404)
                    return
                reports[case] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                self.send_response(204)
                self.end_headers()
                done[case].set()

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=folder))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            for case in done:
                url = f"http://127.0.0.1:{server.server_port}/{case}/"
                subprocess.run(["xcrun", "simctl", "terminate", phone, BUNDLE], capture_output=True)
                print("Launching", case, flush=True)
                call("xcrun", "simctl", "launch", phone, BUNDLE, url)
                completed = done[case].wait(150)
                call("xcrun", "simctl", "io", phone, "screenshot", str(OUT / f"{case}.png"))
                if not completed:
                    raise RuntimeError(case + " did not report from the iOS web process")
                print(json.dumps(reports[case], ensure_ascii=False), flush=True)
                if "error" in reports[case]:
                    raise RuntimeError(reports[case]["error"])
        finally:
            server.shutdown()
            (OUT / "frames.json").write_text(json.dumps(dict(device="iPhone 17 Pro Simulator", runtime=runtime,
                                                            reports=reports), indent=2))

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            print(f"iPhone 17 Pro Simulator · {runtime} · synthetic touch input in WKWebView\n", file=f)
            print("| Build | Renderer | Scenario | Frame interval p50 / p95 (ms) | Frames >33.5ms | JS rAF p95 (ms) |\n"
                  "|---|---|---|---|---:|---:|", file=f)
            for case, report in reports.items():
                for name, s in report["scenarios"].items():
                    print(f"| {case} | {report['renderer']} | {name} | {s['intervalP50']} / {s['intervalP95']} | "
                          f"{s['over33ms']} | {s['appRafP95']} |", file=f)


if __name__ == "__main__":
    main()
