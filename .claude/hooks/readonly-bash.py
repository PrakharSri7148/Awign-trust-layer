#!/usr/bin/env python3
"""PreToolUse hook for the edge-validator-ai subagent: allow only read-only Bash.

Reads the hook JSON on stdin. Exit 0 = allow, exit 2 = block (stderr goes back to the agent).
Strategy is an allowlist: every pipeline/&&/;-separated segment must start with an approved
read-only command, and shell features that can hide writes (redirects, $( ), backticks) are refused.
"""
import json
import re
import shlex
import sys

SIMPLE = {
    "ls", "cat", "head", "tail", "wc", "grep", "rg", "pwd", "echo", "file", "stat", "du",
    "sort", "uniq", "diff", "tree", "which", "basename", "dirname", "cut", "tr", "nl", "true",
}
GIT_OK = {"status", "diff", "log", "show", "ls-files", "rev-parse", "blame", "shortlog", "describe"}
FIND_BAD = {"-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"}


def deny(reason):
    print(f"BLOCKED (edge-validator-ai is read-only): {reason}", file=sys.stderr)
    sys.exit(2)


def check_segment(seg):
    try:
        tokens = shlex.split(seg)
    except ValueError:
        deny(f"cannot parse: {seg!r}")
    # strip leading `cd dir &&`-style handled by splitting; skip env assignments
    while tokens and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tokens[0]):
        tokens.pop(0)
    if not tokens:
        return
    cmd, args = tokens[0].split("/")[-1], tokens[1:]

    if cmd == "cd":
        return
    if cmd in SIMPLE:
        return
    if cmd == "sed" and not any(a == "-i" or a.startswith("-i") or a.startswith("--in-place") for a in args):
        return
    if cmd == "find" and not FIND_BAD.intersection(args):
        return
    if cmd == "git" and args and args[0] in GIT_OK:
        return
    if cmd in ("python", "python3") or re.match(r"python3\.\d+$", cmd):
        if args[:2] == ["-m", "pytest"]:
            return
        deny("python is only allowed as `python -m pytest ...`")
    if cmd == "npm" and args and (args[0] == "test" or args[:2] == ["run", "test"] or args[:2] == ["run", "lint"]):
        return
    if cmd == "node" and args[:1] == ["--test"]:
        return
    deny(f"`{cmd}` is not on the read-only allowlist")


def main():
    data = json.load(sys.stdin)
    command = (data.get("tool_input") or {}).get("command", "")
    if "`" in command or "$(" in command or "<(" in command:
        deny("command substitution is not allowed")
    # redirects: permit only 2>&1 and >/dev/null variants
    stripped = re.sub(r"\d?>\s*/dev/null|2>&1|&>\s*/dev/null", "", command)
    if re.search(r">|<<", stripped):
        deny("output redirection / heredocs are not allowed")
    for seg in re.split(r"\|\||&&|;|\||\n", stripped):
        check_segment(seg.strip())
    sys.exit(0)


if __name__ == "__main__":
    main()
