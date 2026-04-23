import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import javax.lang.model.element.Modifier;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

public final class JavaAstExtractor {
  private static final int SIGNATURE_CLIP = 240;

  private JavaAstExtractor() {}

  private static final class MemorySourceFile extends SimpleJavaFileObject {
    private final String content;

    MemorySourceFile(String filePath, String content) {
      super(
          URI.create(
              "string:///"
                  + filePath.replace('\\', '/').replace(" ", "%20")),
          JavaFileObject.Kind.SOURCE);
      this.content = content;
    }

    @Override
    public CharSequence getCharContent(boolean ignoreEncodingErrors) {
      return content;
    }
  }

  private static final class ParentFrame {
    final String displayName;
    final String qualifiedName;
    final boolean typeLike;

    ParentFrame(String displayName, String qualifiedName, boolean typeLike) {
      this.displayName = displayName;
      this.qualifiedName = qualifiedName;
      this.typeLike = typeLike;
    }
  }

  private static final class SymbolRecord {
    final String symbolName;
    final String kind;
    final String parentSymbol;
    final String qualifiedSymbolName;
    final int startLine;
    final int endLine;
    final int sliceStartLine;
    final int sliceEndLine;
    final String signature;
    final boolean isExported;

    SymbolRecord(
        String symbolName,
        String kind,
        String parentSymbol,
        String qualifiedSymbolName,
        int startLine,
        int endLine,
        int sliceStartLine,
        int sliceEndLine,
        String signature,
        boolean isExported) {
      this.symbolName = symbolName;
      this.kind = kind;
      this.parentSymbol = parentSymbol;
      this.qualifiedSymbolName = qualifiedSymbolName;
      this.startLine = startLine;
      this.endLine = endLine;
      this.sliceStartLine = sliceStartLine;
      this.sliceEndLine = sliceEndLine;
      this.signature = signature;
      this.isExported = isExported;
    }

    String toJson() {
      return "{"
          + "\"symbolName\":\""
          + escapeJson(symbolName)
          + "\","
          + "\"kind\":\""
          + escapeJson(kind)
          + "\","
          + "\"parentSymbol\":"
          + (parentSymbol == null ? "null" : "\"" + escapeJson(parentSymbol) + "\"")
          + ","
          + "\"qualifiedSymbolName\":\""
          + escapeJson(qualifiedSymbolName)
          + "\","
          + "\"startLine\":"
          + startLine
          + ","
          + "\"endLine\":"
          + endLine
          + ","
          + "\"sliceStartLine\":"
          + sliceStartLine
          + ","
          + "\"sliceEndLine\":"
          + sliceEndLine
          + ","
          + "\"signature\":\""
          + escapeJson(signature)
          + "\","
          + "\"isExported\":"
          + isExported
          + "}";
    }
  }

  private static final class ReferenceRecord {
    final String toModule;
    final String kind;

    ReferenceRecord(String toModule, String kind) {
      this.toModule = toModule;
      this.kind = kind;
    }

    String toJson() {
      return "{"
          + "\"toModule\":\""
          + escapeJson(toModule)
          + "\","
          + "\"kind\":\""
          + escapeJson(kind)
          + "\"}";
    }
  }

  private static final class Extractor extends TreePathScanner<Void, Void> {
    private final CompilationUnitTree unit;
    private final String source;
    private final SourcePositions sourcePositions;
    private final List<SymbolRecord> symbols = new ArrayList<>();
    private final List<ReferenceRecord> references = new ArrayList<>();
    private final Deque<ParentFrame> parentStack = new ArrayDeque<>();

    Extractor(CompilationUnitTree unit, String source, SourcePositions sourcePositions) {
      this.unit = unit;
      this.source = source;
      this.sourcePositions = sourcePositions;
    }

    List<SymbolRecord> getSymbols() {
      return symbols;
    }

    List<ReferenceRecord> getReferences() {
      return references;
    }

    @Override
    public Void visitImport(ImportTree tree, Void unused) {
      String importTarget = String.valueOf(tree.getQualifiedIdentifier());
      references.add(new ReferenceRecord(importTarget, "IMPORTS"));
      if (!importTarget.endsWith(".*")) {
        int lastDot = importTarget.lastIndexOf('.');
        String simpleName = lastDot >= 0 ? importTarget.substring(lastDot + 1) : importTarget;
        if (!simpleName.isEmpty()) {
          recordSymbol(tree, simpleName, "variable", false);
        }
      }
      return null;
    }

    @Override
    public Void visitClass(ClassTree tree, Void unused) {
      String symbolName = String.valueOf(tree.getSimpleName());
      if (symbolName.isEmpty()) {
        return super.visitClass(tree, unused);
      }

      String kind = classifyClassKind(tree);
      boolean exported = parentStack.isEmpty() && hasModifier(tree.getModifiers().getFlags(), Modifier.PUBLIC);
      SymbolRecord symbol = recordSymbol(tree, symbolName, kind, exported);
      parentStack.push(new ParentFrame(symbolName, symbol.qualifiedSymbolName, true));
      super.visitClass(tree, unused);
      parentStack.pop();
      return null;
    }

    @Override
    public Void visitMethod(MethodTree tree, Void unused) {
      String rawName = String.valueOf(tree.getName());
      if (rawName.isEmpty()) {
        return super.visitMethod(tree, unused);
      }

      String symbolName = "<init>".equals(rawName) ? "constructor" : rawName;
      SymbolRecord symbol = recordSymbol(tree, symbolName, "method", false);
      parentStack.push(new ParentFrame(symbolName, symbol.qualifiedSymbolName, false));
      super.visitMethod(tree, unused);
      parentStack.pop();
      return null;
    }

    @Override
    public Void visitVariable(VariableTree tree, Void unused) {
      TreePath parentPath = getCurrentPath() == null ? null : getCurrentPath().getParentPath();
      Tree parentLeaf = parentPath == null ? null : parentPath.getLeaf();
      if (parentLeaf instanceof ClassTree) {
        recordSymbol(tree, String.valueOf(tree.getName()), "property", false);
      }
      return super.visitVariable(tree, unused);
    }

    private SymbolRecord recordSymbol(Tree tree, String symbolName, String kind, boolean exported) {
      ParentFrame parent = parentStack.peek();
      int startLine = lineOf(startPosition(tree));
      int endLine = lineOf(endPosition(tree));
      SymbolRecord symbol =
          new SymbolRecord(
              symbolName,
              kind,
              parent == null ? null : parent.displayName,
              qualifyName(symbolName),
              startLine,
              endLine,
              startLine,
              endLine,
              readSignature(tree),
              exported);
      symbols.add(symbol);
      return symbol;
    }

    private String qualifyName(String symbolName) {
      ParentFrame parent = parentStack.peek();
      return parent == null ? symbolName : parent.qualifiedName + "." + symbolName;
    }

    private String classifyClassKind(ClassTree tree) {
      return switch (tree.getKind()) {
        case INTERFACE, ANNOTATION_TYPE -> "interface";
        case ENUM -> "enum";
        case CLASS, RECORD -> "class";
        default -> "class";
      };
    }

    private long startPosition(Tree tree) {
      return sourcePositions.getStartPosition(unit, tree);
    }

    private long endPosition(Tree tree) {
      return sourcePositions.getEndPosition(unit, tree);
    }

    private int lineOf(long position) {
      if (position < 0 || unit.getLineMap() == null) {
        return 1;
      }
      long line = unit.getLineMap().getLineNumber(position);
      return line <= 0 ? 1 : (int) line;
    }

    private String readSignature(Tree tree) {
      long start = startPosition(tree);
      long end = endPosition(tree);
      if (start < 0 || end < 0 || end <= start || start >= source.length()) {
        return "";
      }
      int safeStart = (int) Math.max(0, start);
      int safeEnd = (int) Math.min(source.length(), end);
      return clipSignature(source.substring(safeStart, safeEnd));
    }
  }

  public static void main(String[] args) throws Exception {
    String filePath = args.length > 0 ? args[0] : "Main.java";
    String content = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);

    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      throw new IllegalStateException("No system Java compiler available");
    }

    DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
    try (StandardJavaFileManager fileManager =
        compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
      JavaFileObject sourceFile = new MemorySourceFile(filePath, content);
      JavacTask task =
          (JavacTask)
              compiler.getTask(
                  null,
                  fileManager,
                  diagnostics,
                  List.of("-proc:none"),
                  null,
                  Collections.singletonList(sourceFile));

      Iterable<? extends CompilationUnitTree> parsedUnits = task.parse();
      Trees trees = Trees.instance(task);

      List<SymbolRecord> symbols = new ArrayList<>();
      List<ReferenceRecord> references = new ArrayList<>();
      for (CompilationUnitTree unit : parsedUnits) {
        Extractor extractor = new Extractor(unit, content, trees.getSourcePositions());
        extractor.scan(unit, null);
        symbols.addAll(extractor.getSymbols());
        references.addAll(extractor.getReferences());
      }

      StringBuilder output = new StringBuilder();
      output.append("{\"symbols\":[");
      for (int i = 0; i < symbols.size(); i++) {
        if (i > 0) {
          output.append(',');
        }
        output.append(symbols.get(i).toJson());
      }
      output.append("],\"references\":[");
      for (int i = 0; i < references.size(); i++) {
        if (i > 0) {
          output.append(',');
        }
        output.append(references.get(i).toJson());
      }
      output.append("]}");
      System.out.print(output);
    }
  }

  private static boolean hasModifier(Set<Modifier> modifiers, Modifier expected) {
    return modifiers != null && modifiers.contains(expected);
  }

  private static String clipSignature(String raw) {
    String collapsed = raw == null ? "" : raw.replaceAll("\\s+", " ").trim();
    if (collapsed.length() > SIGNATURE_CLIP) {
      return collapsed.substring(0, SIGNATURE_CLIP - 1) + "\u2026";
    }
    return collapsed;
  }

  private static String escapeJson(String raw) {
    StringBuilder escaped = new StringBuilder();
    for (int i = 0; i < raw.length(); i++) {
      char ch = raw.charAt(i);
      switch (ch) {
        case '\\' -> escaped.append("\\\\");
        case '"' -> escaped.append("\\\"");
        case '\n' -> escaped.append("\\n");
        case '\r' -> escaped.append("\\r");
        case '\t' -> escaped.append("\\t");
        default -> {
          if (ch < 0x20) {
            escaped.append(String.format("\\u%04x", (int) ch));
          } else {
            escaped.append(ch);
          }
        }
      }
    }
    return escaped.toString();
  }
}
