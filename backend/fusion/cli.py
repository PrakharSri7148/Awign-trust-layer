"""Command line for the JS <-> Python parity check: reads {"cases": {name: [sample, ...]}} on stdin, prints each case's window
features and activity as JSON.   python -m fusion.cli windows < cases.json"""
import json
import sys

from . import windows


def main(argv=None):
    argv = argv or sys.argv[1:]
    if argv[:1] != ["windows"]:
        print("usage: python -m fusion.cli windows < cases.json", file=sys.stderr)
        return 2
    cases = json.load(sys.stdin)["cases"]
    out = {}
    for name, samples in cases.items():
        f = windows.window_features(samples)
        out[name] = {**f, "activity": windows.activity(f)}
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
