"""Writes the Python API reference (one Markdown page per package) from the SDK's source with griffe, for
scripts/build-api-reference.mjs. Static analysis only: nothing is imported or run.

    uv run --with griffe python tools/reference/python_api.py <output folder>
"""

import json
import sys
from pathlib import Path

import griffe

MONOREPO = Path(__file__).resolve().parents[4]
PACKAGES = MONOREPO / "sdks" / "python" / "packages"
ORDER = ["sdk", "core", "auth", "audit", "notification", "events", "observability", "fastapi", "security", "migrations",
         "tls_provider", "audit_auth", "notification_auth"]


def distribution(module: str) -> Path:
    return PACKAGES / f"egradx-{module.replace('_', '-')}"


def first_paragraph(text: str | None) -> str:
    if not text:
        return ""
    return text.strip().split("\n\n")[0].replace("\n", " ").strip()


def md(text: str | None) -> str:
    """Docstring text as Markdown: reST double backquotes become code spans."""
    return (text or "").replace("``", "`").strip()


def annotation(value) -> str:
    return "" if value is None else str(value)


def signature(function) -> str:
    parts = []
    for parameter in function.parameters:
        if parameter.name in ("self", "cls"):
            continue
        kind = str(parameter.kind.value) if parameter.kind else ""
        prefix = "*" if "var-positional" in kind else "**" if "var-keyword" in kind else ""
        text = f"{prefix}{parameter.name}"
        if parameter.annotation is not None:
            text += f": {annotation(parameter.annotation)}"
        if parameter.default is not None:
            text += f" = {parameter.default}"
        parts.append(text)
    returns = f" -> {annotation(function.returns)}" if function.returns is not None else ""
    prefix = "async def" if "async" in {str(label) for label in function.labels} else "def"
    return f"{prefix} {function.name}({', '.join(parts)}){returns}"


def resolve(member):
    try:
        return member.final_target if member.is_alias else member
    except Exception:  # an alias to something outside the SDK
        return None


def public(obj):
    names = sorted(obj.exports) if getattr(obj, "exports", None) else [n for n in obj.members if not n.startswith("_")]
    for name in names:
        member = obj.members.get(name)
        if member is not None:
            yield name, member


def render_class(name: str, cls, lines: list[str]) -> None:
    bases = ", ".join(str(b) for b in cls.bases)
    lines += [f"### `{name}`", "", f"```python\nclass {name}{f'({bases})' if bases else ''}\n```", ""]
    if cls.docstring:
        lines += [md(cls.docstring.value), ""]
    fields = [(n, m) for n, m in cls.members.items() if not n.startswith("_") and m.is_attribute and not m.is_alias and m.annotation is not None]
    if fields:
        lines += ["| Field | Type | Default |", "|---|---|---|"]
        for field_name, field in fields:
            default = f"`{field.value}`" if field.value is not None else ""
            lines.append(f"| `{field_name}` | `{annotation(field.annotation)}` | {default.replace('|', chr(92) + '|')} |")
        lines.append("")
    for method_name, method in cls.members.items():
        if method.is_alias or not method.is_function or (method_name.startswith("_") and method_name != "__init__"):
            continue
        lines += [f"#### `{method_name}`" if method_name != "__init__" else "#### Constructor", "", f"```python\n{signature(method)}\n```", ""]
        if method.docstring:
            lines += [md(method.docstring.value), ""]


def render(module_name: str) -> tuple[str, str]:
    loader = griffe.GriffeLoader(search_paths=[str(p / "src") for p in PACKAGES.iterdir() if (p / "src").is_dir()])
    module = loader.load(f"egradx.{module_name}")
    loader.resolve_aliases(implicit=False, external=False)
    package = distribution(module_name)
    title = f"egradx-{module_name.replace('_', '-')}"
    readme = package / "README.md"
    overview = readme.read_text(encoding="utf-8").split("\n", 1)[1] if readme.exists() else md(module.docstring.value if module.docstring else "")
    lines = [overview.strip(), "", f"Import from `egradx.{module_name}`.", ""]
    classes, functions, others, reexported = [], [], [], []
    for name, member in public(module):
        target = resolve(member)
        if target is None:
            continue
        owner = target.module.path if hasattr(target, "module") else ""
        if member.is_alias and not owner.startswith(f"egradx.{module_name}"):
            reexported.append((name, owner))
        elif target.is_class:
            classes.append((name, target))
        elif target.is_function:
            functions.append((name, target))
        elif target.is_attribute:
            others.append((name, target))
    if classes:
        lines += ["## Classes", ""]
        for name, cls in classes:
            render_class(name, cls, lines)
    if functions:
        lines += ["## Functions", ""]
        for name, function in functions:
            lines += [f"### `{name}`", "", f"```python\n{signature(function)}\n```", ""]
            if function.docstring:
                lines += [md(function.docstring.value), ""]
    if others:
        lines += ["## Constants", "", "| Name | Value |", "|---|---|"]
        for name, attribute in others:
            value = str(attribute.value or "").replace("|", "\\|").replace("\n", " ")
            lines.append(f"| `{name}` | `{value[:120]}` |")
        lines.append("")
    if reexported:
        owners = sorted({owner.split(".")[1] for _, owner in reexported if owner.startswith("egradx.")})
        lines += ["## Re-exported", "", f"Also importable from here: everything public of {', '.join(f'[`egradx.{o}`](egradx-{o.replace(chr(95), chr(45))}.md)' for o in owners)}.", ""]
    return title, "\n".join(lines)


def main() -> None:
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    pages = []
    for name in ORDER:
        if not (distribution(name) / "src" / "egradx" / name).exists():
            continue
        title, body = render(name)
        description = first_paragraph(body).replace("`", "").replace("*", "")[:200]
        front = f"---\ntitle: {json.dumps(title)}\ndescription: {json.dumps(description or f'The API of {title}.')}\n---\n\n"
        note = "<!-- Generated by scripts/build-api-reference.mjs from the SDK's source: do not edit. -->\n\n"
        (target / f"{title}.md").write_text(front + note + body.strip() + "\n", encoding="utf-8", newline="\n")
        pages.append((title, description))
    meta = {"title": "Python", "pages": ["index", *[title for title, _ in pages]]}
    (target / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8", newline="\n")
    def cell(text: str) -> str:  # MDX: no table breaks, no tags or expressions
        return text.replace("|", "\\|").replace("<", "&lt;").replace(">", "&gt;").replace("{", "\\{").replace("}", "\\}")

    rows = "\n".join(f"| [`{title}`](/docs/reference/python/{title}) | {cell(description)} |" for title, description in pages)
    index = ("---\ntitle: \"Python API\"\ndescription: \"The Python SDK, package by package.\"\n---\n\n"
             "{/* Generated by scripts/build-api-reference.mjs from the SDK's source: do not edit. */}\n\n"
             "The Python SDK, package by package, imported as `egradx.*`. Most applications need only `egradx-sdk` "
             "(`from egradx.sdk import …`), which re-exports the libraries it wires, and `egradx-events` when they publish "
             "events. Each page starts with the package's own overview, then every export.\n\n"
             f"| Package | What it is |\n|---|---|\n{rows}\n")
    (target / "index.mdx").write_text(index, encoding="utf-8", newline="\n")
    print(f"python: {len(pages)} packages")


if __name__ == "__main__":
    main()
