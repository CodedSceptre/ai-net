"""Convert scanner output without including any credential values."""
import json
import sys
from pathlib import Path

tool, directory = sys.argv[1:]
directory = Path(directory)
raw = (directory / "scan.json").read_text()
rules = {}
results = []


def finding(rule, title, path, severity="warning", line=1):
    rules.setdefault(rule, {"id": rule, "shortDescription": {"text": title}})
    results.append({
        "ruleId": rule,
        "level": severity,
        "message": {"text": title},
        "locations": [{"physicalLocation": {
            "artifactLocation": {"uri": path},
            "region": {"startLine": max(1, int(line or 1))},
        }}],
        "partialFingerprints": {"finding/v1": f"{rule}:{path}:{line}"},
    })


if tool == "TruffleHog":
    for entry in map(json.loads, raw.splitlines()):
        if entry.get("Verified"):
            location = entry["SourceMetadata"]["Data"]["Git"]
            detector = entry["DetectorName"]
            finding(detector, f"Verified {detector} credential", location["file"],
                    "error", location.get("line"))
elif tool.startswith("npm "):
    package_dir = tool.split()[1]
    report = json.loads(raw or "{}")
    vulnerabilities = report.get("vulnerabilities")
    if vulnerabilities is None:
        raise SystemExit(f"{tool} did not produce an audit report. See the scanner step for details.")
    for name, vulnerability in vulnerabilities.items():
        severity = "error" if vulnerability["severity"] in ("high", "critical") else "warning"
        for advisory in vulnerability["via"]:
            if isinstance(advisory, dict):
                finding(str(advisory["source"]), f"{name}: {advisory['title']}",
                        f"{package_dir}/package-lock.json", severity)
else:
    report = json.loads(raw or "{}")
    if "vulnerabilities" not in report:
        raise SystemExit("Cargo audit did not produce an audit report. See the scanner step for details.")
    for issue in report["vulnerabilities"]["list"]:
        advisory = issue["advisory"]
        finding(advisory["id"], advisory["title"], "smart-contracts/Cargo.lock", "error")

(directory / "scan.sarif").write_text(json.dumps({
    "version": "2.1.0",
    "runs": [{"tool": {"driver": {"name": tool, "rules": list(rules.values())}},
              "results": results}],
}))
