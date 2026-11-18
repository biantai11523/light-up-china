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
        sequence = [("baseline", 1), ("candidate", 1), ("candidate", 2), ("baseline", 2)]
        done = threading.Event()
        reports = {}
        for case, src in zip(["baseline","candidate"], sys.argv[1:], strict=True):
            dist = shutil.copytree(src, tmp / case)
            index = dist / "index.html"
            index.write_text(index.read_text().replace("<head>", '<head><script src="/qa.js"></script>'))

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                route = urlsplit(self.path).path.strip("/").split("/")
                if len(route) != 3 or route[0] != "result" or not route[2].isdigit():
                    self.send_error(404)
                    return
                case, run = route[1], int(route[2])
                if (case, run) not in sequence:
                    self.send_error(404)
                    return
                result = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                reports[f"{case}-{run}"] = result
                print(case, run, json.dumps(result, ensure_ascii=False), flush=True)
                try:
                    call("xcrun", "simctl", "io", phone, "screenshot", str(OUT / f"{case}-{run}.png"))
                    i = sequence.index((case, run)) + 1
                    next_url = f"/{sequence[i][0]}/?pass={sequence[i][1]}" if i < len(sequence) and "error" not in result else None
                    payload = json.dumps({"next": next_url}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type","application/json")
                    self.send_header("Content-Length",str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    if next_url is None:
                        done.set()
                except Exception as exc:
                    result["error"] = str(exc)
                    done.set()
                    raise

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=folder))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/baseline/?pass=1"
            print("Comparing both bundles in one WKWebView (A/B/B/A)", flush=True)
            call("xcrun", "simctl", "launch", phone, BUNDLE, url)
            if not done.wait(420):
                call("xcrun", "simctl", "io", phone, "screenshot", str(OUT / "timeout.png"))
                raise RuntimeError("The iOS web process did not finish the trace sequence")
            errors = [r["error"] for r in reports.values() if "error" in r]
            if errors or len(reports) != len(sequence):
                raise RuntimeError(errors or "Incomplete trace sequence")
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
