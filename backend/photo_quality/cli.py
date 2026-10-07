"""python -m photo_quality.cli photo1.jpg photo2.jpg ...  ->  JSON reports (used by the parity tool)."""
import json
import mimetypes
import sys

from . import analyze_image


def main(paths):
    out = []
    for p in paths:
        with open(p, "rb") as f:
            data = f.read()
        out.append({"file": p, "report": analyze_image(data, mimetypes.guess_type(p)[0])})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
