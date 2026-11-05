import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import javax.tools.*;

/**
 * Compiles and runs every case folder under a root with the real javac and
 * JVM, all in one JVM so a few hundred cases take seconds. Writes what happened
 * beside the sources, for src/java/differential.test.ts to compare.
 *
 *   java scripts/java-oracle/Oracle.java <root>
 */
public class Oracle {
  public static void main(String[] argv) throws Exception {
    JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
    PrintStream realOut = System.out;
    try (DirectoryStream<Path> cases = Files.newDirectoryStream(Paths.get(argv[0]))) {
      for (Path dir : cases) {
        if (Files.isDirectory(dir)) one(javac, dir);
      }
    }
    System.setOut(realOut);
  }

  static void one(JavaCompiler javac, Path dir) throws Exception {
    List<File> sources = new ArrayList<>();
    try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, "*.java")) {
      for (Path f : files) sources.add(f.toFile());
    }
    Collections.sort(sources);
    Path out = dir.resolve("classes");
    Files.createDirectories(out);
    StringWriter text = new StringWriter();
    try (StandardJavaFileManager fm = javac.getStandardFileManager(null, null, StandardCharsets.UTF_8)) {
      // With a plain writer, javac prints exactly what it prints on the command line.
      boolean ok = javac.getTask(new PrintWriter(text), fm, null, List.of("-g", "-d", out.toString(), "-Xlint:none", "-proc:none", "-Xmaxerrs", "100"), null, fm.getJavaFileObjectsFromFiles(sources)).call();
      Files.writeString(dir.resolve("diag.txt"), text.toString());
      if (!ok) return;
    }
    String mainClass = Files.readString(dir.resolve("main.txt")).trim();
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    PrintStream capture = new PrintStream(buf, true, StandardCharsets.UTF_8);
    PrintStream old = System.out;
    System.setOut(capture);
    StringBuilder exc = new StringBuilder();
    try (URLClassLoader loader = new URLClassLoader(new URL[] {out.toUri().toURL()})) {
      Method m = loader.loadClass(mainClass).getMethod("main", String[].class);
      try {
        m.invoke(null, (Object) new String[0]);
      } catch (InvocationTargetException e) {
        Throwable t = e.getCause();
        exc.append(t.getClass().getName()).append('\n');
        exc.append(t.getMessage() == null ? "\u0001null" : t.getMessage()).append('\n');
        for (StackTraceElement s : t.getStackTrace()) {
          if (s.getClassName().contains(".") || s.getClassName().equals("Oracle") || s.getFileName() == null) continue;
          exc.append(s.getClassName()).append('.').append(s.getMethodName()).append(':').append(s.getLineNumber()).append('\n');
        }
      }
    } finally {
      System.setOut(old);
    }
    capture.flush();
    Files.write(dir.resolve("stdout.txt"), buf.toByteArray());
    Files.writeString(dir.resolve("exc.txt"), exc.toString());
  }
}
