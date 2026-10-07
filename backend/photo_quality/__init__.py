"""Server-side photo-quality engine.

A Python port of client/src/lib/photoQuality, reading the same thresholds.json.
The client's verdict is advisory UX; this is the one the backend trusts.
"""
from .analyze import analyze_image  # noqa: F401
