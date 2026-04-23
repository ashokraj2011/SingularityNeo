#!/usr/bin/env python3
"""
Python AST extractor for SingularityNeo code indexing.

Reads a JSON payload from stdin:
  { "filePath": "...", "content": "..." }

Writes a JSON payload to stdout:
  { "symbols": [...], "references": [...] }

The output shape intentionally mirrors the ParsedSourceFile contract used by
the Node-side code indexer so the surrounding ingestion pipeline stays stable.
"""

from __future__ import annotations

import ast
import json
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

SIGNATURE_CLIP = 240


def clip_signature(raw: str) -> str:
    collapsed = " ".join((raw or "").split())
    if len(collapsed) > SIGNATURE_CLIP:
        return f"{collapsed[:SIGNATURE_CLIP - 1]}…"
    return collapsed


def get_signature(source: str, node: ast.AST, lines: List[str]) -> str:
    segment = ast.get_source_segment(source, node)
    if segment:
      return clip_signature(segment)
    line_no = getattr(node, "lineno", 1) or 1
    if 1 <= line_no <= len(lines):
      return clip_signature(lines[line_no - 1])
    return ""


def is_exported(name: str) -> bool:
    return bool(name) and not name.startswith("_")


def build_import_module(node: ast.ImportFrom) -> str:
    prefix = "." * int(getattr(node, "level", 0) or 0)
    module = node.module or ""
    return f"{prefix}{module}" if module else prefix


@dataclass
class ParentFrame:
    display_name: str
    qualified_name: str
    kind: str


class SymbolCollector(ast.NodeVisitor):
    def __init__(self, source: str) -> None:
        self.source = source
        self.lines = source.splitlines()
        self.symbols: List[Dict[str, Any]] = []
        self.references: List[Dict[str, Any]] = []
        self.parent_stack: List[ParentFrame] = []

    def current_parent(self) -> Optional[ParentFrame]:
        return self.parent_stack[-1] if self.parent_stack else None

    def current_qualified_name(self, name: str) -> str:
        parent = self.current_parent()
        if not parent:
            return name
        return f"{parent.qualified_name}.{name}"

    def push_symbol(
        self,
        node: ast.AST,
        symbol_name: str,
        kind: str,
        exported: bool,
    ) -> ParentFrame:
        parent = self.current_parent()
        qualified_name = self.current_qualified_name(symbol_name)
        start_line = int(getattr(node, "lineno", 1) or 1)
        end_line = int(getattr(node, "end_lineno", start_line) or start_line)
        self.symbols.append(
            {
                "symbolName": symbol_name,
                "kind": kind,
                "parentSymbol": parent.display_name if parent else None,
                "qualifiedSymbolName": qualified_name,
                "startLine": start_line,
                "endLine": end_line,
                "sliceStartLine": start_line,
                "sliceEndLine": end_line,
                "signature": get_signature(self.source, node, self.lines),
                "isExported": exported,
            }
        )
        return ParentFrame(
            display_name=symbol_name,
            qualified_name=qualified_name,
            kind=kind,
        )

    def record_binding_symbol(
        self,
        node: ast.AST,
        symbol_name: str,
        kind: str,
        exported: Optional[bool] = None,
    ) -> None:
        parent = self.current_parent()
        start_line = int(getattr(node, "lineno", 1) or 1)
        end_line = int(getattr(node, "end_lineno", start_line) or start_line)
        self.symbols.append(
            {
                "symbolName": symbol_name,
                "kind": kind,
                "parentSymbol": parent.display_name if parent else None,
                "qualifiedSymbolName": self.current_qualified_name(symbol_name),
                "startLine": start_line,
                "endLine": end_line,
                "sliceStartLine": start_line,
                "sliceEndLine": end_line,
                "signature": get_signature(self.source, node, self.lines),
                "isExported": is_exported(symbol_name)
                if exported is None
                else exported,
            }
        )

    def binding_kind_for_current_scope(self) -> str:
        parent = self.current_parent()
        return "property" if parent and parent.kind == "class" else "variable"

    def classify_function_kind(self, node: ast.AST) -> str:
        parent = self.current_parent()
        if not parent or parent.kind != "class":
            return "function"

        decorators = getattr(node, "decorator_list", []) or []
        for decorator in decorators:
            if isinstance(decorator, ast.Name) and decorator.id == "property":
                return "property"
            if isinstance(decorator, ast.Attribute) and decorator.attr in (
                "setter",
                "deleter",
            ):
                return "property"
        return "method"

    def record_assignment_targets(
        self,
        node: ast.AST,
        targets: List[ast.expr],
        kind: str,
        exported: Optional[bool] = None,
    ) -> None:
        for target in targets:
            if isinstance(target, ast.Name):
                self.record_binding_symbol(node, target.id, kind, exported)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.references.append({"toModule": alias.name, "kind": "IMPORTS"})
            bound_name = alias.asname or alias.name.split(".", 1)[0]
            if bound_name:
                self.record_binding_symbol(
                    node,
                    bound_name,
                    self.binding_kind_for_current_scope(),
                    False,
                )

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module_name = build_import_module(node)
        if module_name:
            self.references.append({"toModule": module_name, "kind": "IMPORTS"})
        for alias in node.names:
            if alias.name == "*":
                continue
            bound_name = alias.asname or alias.name
            if bound_name:
                self.record_binding_symbol(
                    node,
                    bound_name,
                    self.binding_kind_for_current_scope(),
                    False,
                )

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        frame = self.push_symbol(node, node.name, "class", is_exported(node.name))
        self.parent_stack.append(frame)
        for child in node.body:
            self.visit(child)
        self.parent_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        kind = self.classify_function_kind(node)
        exported = False if kind in ("method", "property") else is_exported(node.name)
        frame = self.push_symbol(node, node.name, kind, exported)
        self.parent_stack.append(frame)
        for child in node.body:
            self.visit(child)
        self.parent_stack.pop()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.visit_FunctionDef(node)

    def visit_Assign(self, node: ast.Assign) -> None:
        parent = self.current_parent()
        if parent is None:
            self.record_assignment_targets(node, list(node.targets), "variable")
        elif parent.kind == "class":
            self.record_assignment_targets(node, list(node.targets), "property", False)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        parent = self.current_parent()
        target = [node.target]
        if parent is None:
            self.record_assignment_targets(node, target, "variable")
        elif parent.kind == "class":
            self.record_assignment_targets(node, target, "property", False)


def main() -> int:
    payload = json.load(sys.stdin)
    file_path = payload.get("filePath") or "<unknown>"
    content = payload.get("content") or ""
    tree = ast.parse(content, filename=file_path)
    collector = SymbolCollector(content)
    collector.visit(tree)
    json.dump(
        {
            "symbols": collector.symbols,
            "references": collector.references,
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - error channel only
        sys.stderr.write(f"{type(exc).__name__}: {exc}\n")
        raise
