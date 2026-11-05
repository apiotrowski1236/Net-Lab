/**
 * Java programs for the differential test. Each one runs through the real
 * javac and JVM and through this interpreter, and the two have to agree.
 */
export interface Case {
  id: string;
  /** File name to source. A case with `main` gets a Main.java wrapped around that text. */
  files?: Record<string, string>;
  main?: string;
  /** Extra members for Main, outside main(). */
  members?: string;
  /** Top of Main.java, such as imports. */
  head?: string;
}

const PLAYER = `public class Player {
  private String name;
  private int health;
  public Player(String name, int health) {
    this.name = name;
    this.health = health;
  }
  public String getName() { return name; }
  public int getHealth() { return health; }
  public void takeDamage(int amount) {
    health = health - amount;
    if (health < 0) {
      health = 0;
    }
  }
  public String toString() { return name + " (" + health + ")"; }
}
`;

const LIST = 'import java.util.ArrayList;\nimport java.util.List;\nimport java.util.Arrays;\n';

/** Programs that compile. Output, exception, and stack lines have to match. */
export const GOOD: Case[] = [
  { id: 'hello', main: 'System.out.println("Hello");' },
  { id: 'print-kinds', main: 'System.out.print(1); System.out.print(2.5); System.out.print(true); System.out.print(\'c\'); System.out.print("s"); System.out.println(); System.out.println(10000000000L); Object o = null; System.out.println(o); String s = null; System.out.println(s); System.out.println("a" + s);' },
  {
    id: 'int-math',
    main: `System.out.println(7 / 2); System.out.println(-7 / 2); System.out.println(7 % 3); System.out.println(-7 % 3); System.out.println(7 % -3);
    System.out.println(2147483647 + 1); System.out.println(-2147483648 - 1); System.out.println(46341 * 46341); System.out.println(Integer.MAX_VALUE * 2); System.out.println(Integer.MIN_VALUE / -1);
    System.out.println(1 + 2 + "3" + 4 + 5); System.out.println(5 + 3 * 2 - 1); System.out.println((5 + 3) * 2); System.out.println(10 - 3 - 2);`,
  },
  {
    id: 'double-print',
    main: `double[] d = { 0.1 + 0.2, 1.0, 100.0, 1e7, 1.0E10, 12345678.9, 0.001, 0.0001, 1e-5, 1.0 / 3, 2.0 / 3, 1e21, 1e22, 123456789012345680.0, 4.9e-324, 1.7976931348623157e308, -0.0, 0.0, 3.14, 1234567.0, 9999999.0, 1.0E7 - 1 };
    for (double x : d) { System.out.println(x); }
    System.out.println(1.0 / 0); System.out.println(-1.0 / 0); System.out.println(0.0 / 0); System.out.println(5.5 % 2); System.out.println(-5.5 % 2);`,
  },
  {
    id: 'casts',
    main: `System.out.println((int) 3.9); System.out.println((int) -3.9); System.out.println((double) 5 / 2); System.out.println((double) (5 / 2)); System.out.println((int) 'A'); System.out.println((char) 66); System.out.println((char) ('a' + 1)); System.out.println('a' + 1); System.out.println((int) 1e20); System.out.println((int) -1e20); System.out.println((int) (0.0 / 0)); System.out.println((long) 3.7);
    int a = 7; int b = 2; System.out.println(a / b); System.out.println((double) a / b); System.out.println(a / (double) b); System.out.println((int) (a / (double) b + 0.5));
    double avg = (90 + 85) / 2; System.out.println(avg); double avg2 = (90 + 85) / 2.0; System.out.println(avg2);`,
  },
  {
    id: 'compound',
    main: `int x = 5; x += 2; x -= 1; x *= 3; x /= 2; x %= 5; System.out.println(x); x = 5; x *= 1.5; System.out.println(x); x = 10; x /= 4.0; System.out.println(x); x = 5; x += 0.9; System.out.println(x);
    char c = 'a'; c += 1; System.out.println(c); c++; System.out.println(c); double d = 1; d += 1; d /= 4; System.out.println(d); String s = "a"; s += 1; s += 'c'; s += 2.5; s += true; s += null; System.out.println(s);
    int i = 5; int j = i++ + ++i; System.out.println(i + " " + j); int k = 5; k = k++; System.out.println(k); int m = 3; m += m++ * 2; System.out.println(m);`,
  },
  {
    id: 'chars-strings',
    main: `System.out.println("" + 'a' + 1); System.out.println('a' + 'b' + ""); System.out.println('a' + "b"); char c = 65; System.out.println(c); int n = 'z'; System.out.println(n); System.out.println((char) (c + 1)); System.out.println(c + 1); System.out.println("tab\\there \\"q\\" back\\\\slash"); System.out.println('\\n' + 0); System.out.println("\\u0041");
    String s = "Hello, World"; System.out.println(s.length()); System.out.println(s.substring(7)); System.out.println(s.substring(0, 5)); System.out.println(s.indexOf("World")); System.out.println(s.indexOf("zzz")); System.out.println(s.charAt(4)); System.out.println(s.equals("Hello, World")); System.out.println(s.equalsIgnoreCase("HELLO, WORLD")); System.out.println(s.compareTo("Hello")); System.out.println("apple".compareTo("banana")); System.out.println("b".compareTo("a")); System.out.println(s.toUpperCase()); System.out.println(s.toLowerCase()); System.out.println(s.contains("lo,")); System.out.println("  hi ".trim() + "|"); System.out.println(s.replace("l", "L")); System.out.println(s.startsWith("Hell")); System.out.println(s.endsWith("x")); System.out.println(s.isEmpty()); System.out.println(s.lastIndexOf("o")); System.out.println(s.indexOf("o", 5)); System.out.println(s.hashCode());`,
  },
  {
    id: 'string-identity',
    main: `String a = "hi"; String b = "hi"; String c = new String("hi"); System.out.println(a == b); System.out.println(a == c); System.out.println(a.equals(c)); String d = c; System.out.println(c == d); String e = "h"; e += "i"; System.out.println(a == e); System.out.println(a.equals(e)); System.out.println("hi" == "h" + "i");`,
  },
  {
    id: 'math-lib',
    main: `System.out.println(Math.abs(-5)); System.out.println(Math.abs(-5.5)); System.out.println(Math.pow(2, 10)); System.out.println(Math.sqrt(144)); System.out.println(Math.max(3, 7)); System.out.println(Math.min(3.5, 7)); System.out.println(Math.floor(3.7)); System.out.println(Math.ceil(3.2)); System.out.println(Math.round(3.5)); System.out.println(Math.round(-3.5)); System.out.println(Math.round(2.4)); System.out.println(Math.PI); System.out.println(Integer.MAX_VALUE); System.out.println(Integer.MIN_VALUE); System.out.println(Integer.parseInt("42") + 1); System.out.println(Double.parseDouble("2.5") * 2); System.out.println(String.valueOf(12) + 1); System.out.println(Integer.toString(5) + "x");
    int r = (int) (Math.random() * 6) + 1; System.out.println(r >= 1 && r <= 6);`,
  },
  {
    id: 'control',
    main: `int s = 0; for (int i = 0; i < 5; i++) { if (i == 3) { continue; } s += i; } System.out.println(s);
    int w = 10; while (w > 0) { w -= 3; if (w == 4) { break; } } System.out.println(w);
    int d = 0; do { d++; } while (d < 3); System.out.println(d);
    for (int i = 0, j = 10; i < j; i++, j--) { System.out.print(i + ":" + j + " "); } System.out.println();
    for (int i = 0; i < 3; i++) { for (int j = 0; j < 3; j++) { if (j == 2) { break; } System.out.print(i * j); } } System.out.println();
    int x = 5; System.out.println(x > 3 ? "big" : "small"); System.out.println(x > 9 ? 1 : 2.5); boolean t = true, f = false; System.out.println(t && f); System.out.println(t || f); System.out.println(!t); System.out.println(t ^ f); System.out.println(t & f); System.out.println(t | f);
    if (x > 3) System.out.println("a"); else System.out.println("b"); if (x > 9) { System.out.println("c"); } else if (x > 4) { System.out.println("d"); } else { System.out.println("e"); }
    boolean sc = x > 9 && 1 / 0 > 0; System.out.println(sc); int[] counter = new int[1]; boolean q = x > 3 || counter[0]++ > 0; System.out.println(counter[0]);`,
  },
  {
    id: 'arrays',
    head: 'import java.util.Arrays;\n',
    main: `int[] a = new int[3]; System.out.println(a.length); System.out.println(a[0]); a[1] = 5; System.out.println(Arrays.toString(a)); double[] d = new double[2]; System.out.println(d[0]); boolean[] b = new boolean[1]; System.out.println(b[0]); String[] s = new String[2]; System.out.println(s[0]); int[] c = { 1, 2, 3 }; int[] e = c; e[0] = 9; System.out.println(c[0]); int[] f = new int[] { 4, 5 }; System.out.println(f[1]); int t = 0; for (int v : c) { t += v; } System.out.println(t);
    int[][] g = new int[2][3]; g[1][2] = 7; System.out.println(g.length); System.out.println(g[0].length); System.out.println(g[1][2]); int[][] h = { { 1, 2 }, { 3 } }; System.out.println(h[1].length); for (int[] row : h) { for (int v : row) { System.out.print(v); } } System.out.println(); String[] names = { "a", "b" }; for (String n : names) { System.out.print(n); } System.out.println(); System.out.println(Arrays.toString(names)); char[] cs = { 'x', 'y' }; System.out.println(cs[1]); System.out.println(Arrays.toString(new double[] { 1, 2.5 }));`,
  },
  {
    id: 'arraylist',
    head: LIST,
    main: `ArrayList<String> a = new ArrayList<>(); a.add("x"); a.add("y"); a.add(1, "z"); System.out.println(a); System.out.println(a.size()); System.out.println(a.get(1)); System.out.println(a.set(0, "q")); System.out.println(a.contains("y")); System.out.println(a.indexOf("y")); System.out.println(a.remove(0)); System.out.println(a.remove("y")); System.out.println(a.remove("nope")); System.out.println(a); System.out.println(a.isEmpty());
    ArrayList<Integer> n = new ArrayList<Integer>(); n.add(5); n.add(7); n.add(9); n.remove(1); System.out.println(n); n.remove(Integer.valueOf(9)); System.out.println(n); int v = n.get(0); System.out.println(v + 1); int t = 0; for (int x : n) { t += x; } System.out.println(t); for (Integer x : n) { System.out.println(x); } List<Double> d = new ArrayList<>(); d.add(1.5); System.out.println(d); ArrayList<Integer> m = new ArrayList<>(n); m.add(1); System.out.println(n.size() + " " + m.size()); System.out.println(n.equals(m)); a.clear(); System.out.println(a);`,
  },
  {
    id: 'boxing',
    main: `Integer a = 127; Integer b = 127; System.out.println(a == b); Integer c = 128; Integer d = 128; System.out.println(c == d); System.out.println(c.equals(d)); int e = c + 1; System.out.println(e); Double f = 2.5; double g = f * 2; System.out.println(g); Object o = 5; System.out.println(o); System.out.println(o instanceof Integer); int h = (Integer) o; System.out.println(h); Boolean t = true; if (t) { System.out.println("yes"); } Integer i = 5; i++; System.out.println(i); i += 2; System.out.println(i); System.out.println(c.compareTo(d)); System.out.println(a.intValue() + 1); System.out.println(f.doubleValue());`,
  },
  {
    id: 'format',
    main: `System.out.println(String.format("%d|%5d|%-5d|%05d", 1, 2, 3, 4)); System.out.println(String.format("%.2f|%8.3f|%f", 3.14159, 2.5, 1.5)); System.out.println(String.format("%s|%10s|%-10s|", "a", "b", "c")); System.out.printf("%d %s%n", 5, "x"); System.out.println(String.format("%b %c %%", true, 'x')); System.out.println(String.format("%,d", 1234567)); System.out.println(String.format("%.1f %.0f", 0.25, 2.5)); System.out.println(String.format("%s %s %s", 1, 2.5, true));`,
  },
  {
    id: 'class-basic',
    files: {
      'Player.java': PLAYER,
      'Main.java': `public class Main {
  public static void main(String[] args) {
    Player a = new Player("Ada", 100);
    Player b = new Player("Grace", 80);
    a.takeDamage(30);
    b.takeDamage(500);
    System.out.println(a);
    System.out.println(b);
    System.out.println(a.getName() + " " + b.getHealth());
    Player c = a;
    c.takeDamage(10);
    System.out.println(a.getHealth());
    System.out.println(a == c);
    System.out.println(a == b);
    System.out.println(a.equals(c));
  }
}
`,
    },
  },
  {
    id: 'defaults',
    files: {
      'Box.java': `public class Box {
  private int i; private double d; private boolean b; private String s; private char c; private int[] a; private Box next;
  public void show() { System.out.println(i + " " + d + " " + b + " " + s + " " + (int) c + " " + a + " " + next); }
}
`,
      'Main.java': `public class Main { public static void main(String[] args) { new Box().show(); } }
`,
    },
  },
  {
    id: 'ctors',
    files: {
      'Song.java': `public class Song {
  private String title;
  private int plays = 10;
  private static int made = 0;
  public static final int LIMIT = 3;
  public Song() { this("Untitled"); plays++; }
  public Song(String title) { this.title = title; made++; }
  public Song(String title, int plays) { this(title); this.plays = plays; }
  public String getTitle() { return title; }
  public int getPlays() { return plays; }
  public static int getMade() { return made; }
  public Song play() { plays++; return this; }
  public boolean sameTitle(Song other) { return title.equals(other.title); }
  public boolean isOver() { return this.plays > LIMIT; }
}
`,
      'Main.java': `public class Main {
  public static void main(String[] args) {
    Song a = new Song(); Song b = new Song("B"); Song c = new Song("C", 1);
    System.out.println(a.getTitle() + a.getPlays()); System.out.println(b.getTitle() + b.getPlays()); System.out.println(c.getTitle() + c.getPlays());
    System.out.println(Song.getMade()); System.out.println(Song.LIMIT); System.out.println(c.play().play().getPlays()); System.out.println(a.sameTitle(new Song("Untitled"))); System.out.println(Song.getMade()); System.out.println(c.isOver());
  }
}
`,
    },
  },
  {
    id: 'shadow-bug',
    files: {
      'Song.java': `public class Song {
  private String title;
  private int plays;
  public Song(String title, int plays) { title = title; plays = plays; }
  public String getTitle() { return title; }
  public int getPlays() { return plays; }
}
`,
      'Main.java': `public class Main { public static void main(String[] args) { Song s = new Song("A", 3); System.out.println(s.getTitle()); System.out.println(s.getPlays()); } }
`,
    },
  },
  {
    id: 'equals-override',
    files: {
      'Point.java': `public class Point {
  private int x; private int y;
  public Point(int x, int y) { this.x = x; this.y = y; }
  @Override public boolean equals(Object o) { if (!(o instanceof Point)) { return false; } Point p = (Point) o; return x == p.x && y == p.y; }
  @Override public int hashCode() { return 31 * x + y; }
  @Override public String toString() { return "(" + x + ", " + y + ")"; }
}
`,
      'Main.java': `import java.util.ArrayList;
public class Main { public static void main(String[] args) { Point a = new Point(1, 2); Point b = new Point(1, 2); System.out.println(a.equals(b)); System.out.println(a == b); System.out.println(a.equals("x")); System.out.println(a.hashCode()); ArrayList<Point> l = new ArrayList<>(); l.add(a); System.out.println(l.contains(b)); System.out.println(l.indexOf(b)); System.out.println(l); System.out.println("p=" + a); String s = a + "!"; System.out.println(s); } }
`,
    },
  },
  {
    id: 'overloads',
    members: `static String f(int x) { return "int"; } static String f(double x) { return "double"; } static String f(long x) { return "long"; } static String f(Object x) { return "Object"; } static String f(String x) { return "String"; } static String g(double x) { return "g double"; } static String g(Object x) { return "g Object"; } static String h(Integer x) { return "h Integer"; } static String h(long x) { return "h long"; }`,
    main: `System.out.println(f(1)); System.out.println(f(1.0)); System.out.println(f(1L)); System.out.println(f("s")); System.out.println(f('c')); System.out.println(f(new Object() == null)); System.out.println(g(1)); System.out.println(g("x")); System.out.println(h(1)); Integer i = 1; System.out.println(f(i)); System.out.println(h(i));`,
  },
  {
    id: 'pass-by-value',
    files: {
      'StringHolder.java': `public class StringHolder { public String v = "old"; }
`,
      'Main.java': `public class Main {
  static void bump(int x) { x++; }
  static void fill(int[] a) { a[0] = 9; }
  static void swap(int[] a) { a = new int[1]; a[0] = 1; }
  static void rename(StringHolder h) { h.v = "new"; }
  static void reassign(StringHolder h) { h = new StringHolder(); h.v = "other"; }
  public static void main(String[] args) { int n = 1; bump(n); System.out.println(n); int[] a = new int[1]; fill(a); System.out.println(a[0]); swap(a); System.out.println(a[0]); StringHolder h = new StringHolder(); rename(h); System.out.println(h.v); reassign(h); System.out.println(h.v); }
}
`,
    },
  },
  {
    id: 'recursion',
    members: `static int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); } static int fib(int n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); } static boolean even(int n) { if (n == 0) { return true; } return odd(n - 1); } static boolean odd(int n) { if (n == 0) { return false; } return even(n - 1); }`,
    main: `System.out.println(fact(10)); System.out.println(fact(13)); System.out.println(fib(15)); System.out.println(even(10));`,
  },
  {
    id: 'statics',
    files: {
      'Counter.java': `public class Counter {
  private static int total = 5;
  public static int next = total * 2;
  private int mine;
  public void hit() { mine++; total++; }
  public int getMine() { return mine; }
  public static int getTotal() { return total; }
}
`,
      'Main.java': `public class Main {
  private static int score;
  private static final String NAME = "m";
  public static void main(String[] args) { Counter a = new Counter(); Counter b = new Counter(); a.hit(); a.hit(); b.hit(); System.out.println(a.getMine() + " " + b.getMine() + " " + Counter.getTotal() + " " + a.getTotal()); System.out.println(Counter.next); score += 2; add(3); System.out.println(score + NAME); }
  private static void add(int n) { score += n; }
}
`,
    },
  },
  {
    id: 'has-a',
    files: {
      'Song.java': `public class Song {
  private String title; private int seconds;
  public Song(String title, int seconds) { this.title = title; this.seconds = seconds; }
  public int getSeconds() { return seconds; }
  public String toString() { return title; }
}
`,
      'Playlist.java': `import java.util.ArrayList;
public class Playlist {
  private ArrayList<Song> songs = new ArrayList<Song>();
  public void add(Song s) { songs.add(s); }
  public int totalSeconds() { int t = 0; for (Song s : songs) { t += s.getSeconds(); } return t; }
  public Song longest() { Song best = null; for (Song s : songs) { if (best == null || s.getSeconds() > best.getSeconds()) { best = s; } } return best; }
  public String toString() { return "Playlist " + songs; }
}
`,
      'Main.java': `public class Main { public static void main(String[] args) { Playlist p = new Playlist(); System.out.println(p.longest()); p.add(new Song("A", 100)); p.add(new Song("B", 200)); System.out.println(p.totalSeconds()); System.out.println(p.longest()); System.out.println(p); } }
`,
    },
  },
  { id: 'npe-method', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = null;\n    System.out.println("before");\n    p.takeDamage(5);\n  }\n}\n' } },
  { id: 'npe-string', main: 'String s = null;\n    System.out.println(s.length());' },
  { id: 'npe-field', files: { 'Node.java': 'public class Node {\n  public Node next;\n  public int v;\n  private String name;\n  public int len() {\n    return name.length();\n  }\n  public Node getNext() { return next; }\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Node n = new Node();\n    System.out.println(n.next);\n    System.out.println(n.next.v);\n  }\n}\n' } },
  { id: 'npe-this-field', files: { 'Node.java': 'public class Node {\n  private String name;\n  public int len() {\n    return name.length();\n  }\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    new Node().len();\n  }\n}\n' } },
  { id: 'npe-return-value', files: { 'Node.java': 'public class Node {\n  public Node next;\n  public Node getNext() { return next; }\n  public int f() { return 1; }\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    new Node().getNext().f();\n  }\n}\n' } },
  { id: 'npe-assign-field', files: { 'Node.java': 'public class Node {\n  public int v;\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Node n = null;\n    n.v = 3;\n  }\n}\n' } },
  { id: 'npe-array', main: 'int[] a = null;\n    a[0] = 1;' },
  { id: 'npe-array-read', main: 'int[] a = null;\n    System.out.println(a[0]);' },
  { id: 'npe-array-length', main: 'int[] a = null;\n    System.out.println(a.length);' },
  { id: 'npe-array-elem', main: 'String[] a = new String[2];\n    System.out.println(a[1].length());' },
  { id: 'npe-unbox', main: 'Integer a = null;\n    int b = a;' },
  { id: 'npe-list', head: LIST, main: 'ArrayList<String> a = null;\n    a.add("x");' },
  { id: 'npe-equals', main: 'String a = null;\n    System.out.println(a.equals("x"));' },
  { id: 'aioobe', main: 'int[] a = new int[3];\n    a[3] = 1;' },
  { id: 'aioobe-neg', main: 'int[] a = new int[3];\n    int i = -1;\n    System.out.println(a[i]);' },
  { id: 'div-zero', main: 'int a = 0;\n    System.out.println(5 / a);' },
  { id: 'mod-zero', main: 'int a = 0;\n    System.out.println(5 % a);' },
  { id: 'substring-range', main: 'String s = "abc";\n    System.out.println(s.substring(5));' },
  { id: 'substring-range-2', main: 'String s = "abc";\n    System.out.println(s.substring(2, 1));' },
  { id: 'charat-range', main: 'String s = "abc";\n    System.out.println(s.charAt(5));' },
  { id: 'list-range', head: LIST, main: 'ArrayList<String> a = new ArrayList<>();\n    a.get(0);' },
  { id: 'list-set-range', head: LIST, main: 'ArrayList<String> a = new ArrayList<>();\n    a.set(1, "x");' },
  { id: 'list-add-range', head: LIST, main: 'ArrayList<String> a = new ArrayList<>();\n    a.add(1, "x");' },
  { id: 'list-remove-range', head: LIST, main: 'ArrayList<String> a = new ArrayList<>();\n    a.remove(0);' },
  { id: 'list-cme', head: LIST, main: 'ArrayList<String> a = new ArrayList<>();\n    a.add("x"); a.add("y"); a.add("z");\n    for (String s : a) {\n      a.remove(s);\n    }' },
  { id: 'list-no-cme', head: LIST, main: 'ArrayList<String> a = new ArrayList<>();\n    a.add("x"); a.add("y"); a.add("z");\n    for (String s : a) {\n      if (s.equals("y")) { a.remove(s); }\n    }\n    System.out.println(a);' },
  { id: 'cast-fail', main: 'Object o = "x";\n    Integer i = (Integer) o;' },
  { id: 'parse-fail', main: 'int x = Integer.parseInt("abc");' },
  { id: 'neg-array', main: 'int[] a = new int[-1];' },
  { id: 'throw-own', main: 'throw new IllegalArgumentException("bad value");' },
  { id: 'throw-own-2', main: 'throw new IllegalStateException();' },
  { id: 'throw-own-3', files: { 'Acct.java': 'public class Acct {\n  private int b;\n  public void take(int n) {\n    if (n > b) {\n      throw new IllegalArgumentException("too much: " + n);\n    }\n    b -= n;\n  }\n}\n', 'Main.java': 'public class Main {\n  static void go(Acct a) {\n    a.take(5);\n  }\n  public static void main(String[] args) {\n    go(new Acct());\n  }\n}\n' } },
  { id: 'stack-trace-ctor', files: { 'A.java': 'public class A {\n  private int x = 1 / 0;\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    new A();\n  }\n}\n' } },
  { id: 'stack-trace-ctor-2', files: { 'A.java': 'public class A {\n  public A(int n) {\n    System.out.println(1 / n);\n  }\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    A a = new A(1);\n    a = new A(0);\n  }\n}\n' } },
  { id: 'stack-overflow', members: 'static int f(int n) { return f(n + 1) + 1; }', main: 'System.out.println(f(0));' },
  { id: 'print-object-default', main: 'int[] a = new int[1];\n    Object o = a;\n    System.out.println(o instanceof Object);' },
  { id: 'empty-class', files: { 'Blank.java': 'public class Blank {\n}\n', 'Main.java': 'public class Main { public static void main(String[] args) { Blank b = new Blank(); System.out.println(b.equals(b)); System.out.println(b != null); } }\n' } },
  { id: 'nonpublic-class', files: { 'Main.java': 'class Dog {\n  int age = 3;\n  void bark() { System.out.println("woof " + age); }\n}\npublic class Main {\n  public static void main(String[] args) {\n    Dog d = new Dog();\n    d.age = 4;\n    d.bark();\n  }\n}\n' } },
  { id: 'field-access-public', files: { 'Dot.java': 'public class Dot {\n  public int x;\n  int y = 2;\n}\n', 'Main.java': 'public class Main { public static void main(String[] args) { Dot d = new Dot(); d.x = 5; d.y++; d.x += d.y; System.out.println(d.x); } }\n' } },
  { id: 'block-scope', main: 'for (int i = 0; i < 2; i++) { int x = i; System.out.print(x); }\n    for (int i = 0; i < 2; i++) { int x = i * 2; System.out.print(x); }\n    { int y = 1; System.out.print(y); } { int y = 2; System.out.print(y); }\n    System.out.println();' },
  { id: 'definite-assign-ok', main: 'int x; if (args.length > 5) { x = 1; } else { x = 2; } System.out.println(x);\n    int y; y = 3; System.out.println(y);\n    int z; if (args.length > 5) { return; } else { z = 2; } System.out.println(z);\n    int w; while (true) { w = 1; break; } System.out.println(w);' },
  { id: 'final-field', files: { 'F.java': 'public class F {\n  private final int a;\n  private final int b = 2;\n  public static final double RATE = 0.5;\n  public F(int a) { this.a = a; }\n  public int sum() { return a + b; }\n}\n', 'Main.java': 'public class Main { public static void main(String[] args) { final int k = 3; System.out.println(new F(k).sum()); System.out.println(F.RATE); } }\n' } },
  { id: 'cond-types', main: 'int x = 1; char c = x > 0 ? \'a\' : \'b\'; System.out.println(c); System.out.println(x > 0 ? 1 : \'b\'); System.out.println(x > 0 ? \'a\' : 98); String s = x > 0 ? "y" : null; System.out.println(s); Integer i = x > 0 ? 5 : null; System.out.println(i); Object o = x > 0 ? "s" : 1; System.out.println(o);' },
  { id: 'nested-calls', files: { 'V.java': 'public class V {\n  private int n;\n  public V(int n) { this.n = n; }\n  public V add(V o) { return new V(n + o.n); }\n  public int get() { return n; }\n  public String toString() { return "V" + n; }\n}\n', 'Main.java': 'public class Main { public static void main(String[] args) { V a = new V(1); V b = new V(2); System.out.println(a.add(b).add(a).get()); System.out.println(a.add(b)); System.out.println(a.toString().length()); } }\n' } },
  { id: 'to-string-null', files: { 'T.java': 'public class T {\n  public String toString() { return null; }\n}\n', 'Main.java': 'public class Main { public static void main(String[] args) { System.out.println(new T()); System.out.println("a" + new T()); } }\n' } },
  { id: 'loop-order', main: 'int total = 0;\n    for (int i = 1; i <= 100; i++) {\n      if (i % 15 == 0) { total += 3; } else if (i % 5 == 0) { total += 2; } else if (i % 3 == 0) { total += 1; }\n    }\n    System.out.println(total);\n    String s = "";\n    for (int i = 5; i > 0; i -= 2) { s = i + s; }\n    System.out.println(s);' },
  { id: 'bits', main: 'System.out.println(5 & 3); System.out.println(5 | 3); System.out.println(5 ^ 3); System.out.println(~5); System.out.println(1 << 3); System.out.println(-8 >> 1); System.out.println(-8 >>> 28);' },
  { id: 'long-math', main: 'long a = 3000000000L; System.out.println(a * 2); long b = 7; System.out.println(b / 2); int c = 5; long d = c; System.out.println(d + 1); System.out.println(a > c);' },
];

/** Programs javac refuses. The first error has to match in place and wording. */
export const BAD: Case[] = [
  { id: 'e-missing-semi', main: 'int x = 5\n    System.out.println(x);' },
  { id: 'e-missing-semi-2', main: 'System.out.println("hi")\n    int y = 1;' },
  { id: 'e-missing-paren', main: 'System.out.println("hi";' },
  { id: 'e-missing-brace', files: { 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  \n}\n' } },
  { id: 'e-extra-brace', files: { 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  }\n}\n}\n' } },
  { id: 'e-unclosed-string', main: 'String s = "abc;\n    int x = 1;' },
  { id: 'e-unclosed-char', main: "char c = 'a;\n    int x = 1;" },
  { id: 'e-empty-char', main: "char c = '';" },
  { id: 'e-long-char', main: "char c = 'ab';" },
  { id: 'e-bad-escape', main: 'String s = "a\\qb";' },
  { id: 'e-int-too-big', main: 'int x = 3000000000;' },
  { id: 'e-reserved-name', main: 'int class = 1;' },
  { id: 'e-stray-else', main: 'int x = 1;\n    else { x = 2; }' },
  { id: 'e-if-semi-else', main: 'int x = 1;\n    if (x > 0); { x = 2; } else { x = 3; }' },
  { id: 'e-no-return-type', files: { 'Song.java': 'public class Song {\n  public play() {\n  }\n}\n' } },
  { id: 'e-stmt-in-class', files: { 'Song.java': 'public class Song {\n  private int x;\n  x = 5;\n}\n' } },
  { id: 'e-println-in-class', files: { 'Song.java': 'public class Song {\n  System.out.println("hi");\n}\n' } },
  { id: 'e-method-in-method', files: { 'Song.java': 'public class Song {\n  public void a() {\n    public void b() {\n    }\n  }\n}\n' } },
  { id: 'e-not-stmt', main: 'int x = 1;\n    x + 1;' },
  { id: 'e-not-stmt-2', main: '5;' },
  { id: 'e-not-stmt-3', main: 'int x = 1;\n    x;' },
  { id: 'e-not-stmt-4', main: '"hello";' },
  { id: 'e-if-no-paren', main: 'int x = 1;\n    if x > 0 {\n      x = 2;\n    }' },
  { id: 'e-assign-in-if', main: 'int x = 1;\n    if (x = 2) {\n      x = 3;\n    }' },
  { id: 'e-if-int', main: 'int x = 1;\n    if (x) {\n      x = 3;\n    }' },
  { id: 'e-while-string', main: 'while ("x") {\n    }' },
  { id: 'e-cap-string', main: 'string s = "a";' },
  { id: 'e-cap-int', main: 'Int x = 1;' },
  { id: 'e-bool', main: 'bool x = true;' },
  { id: 'e-unknown-class', main: 'Dragon d = new Dragon();' },
  { id: 'e-unknown-class-field', files: { 'A.java': 'public class A {\n  private Foo f;\n}\n' } },
  { id: 'e-unknown-class-param', files: { 'A.java': 'public class A {\n  public void go(Bar b) { }\n}\n' } },
  { id: 'e-unknown-return', files: { 'A.java': 'public class A {\n  public Baz go() { return null; }\n}\n' } },
  { id: 'e-no-import', main: 'ArrayList<String> a = new ArrayList<>();' },
  { id: 'e-no-scanner', main: 'Scanner s = new Scanner(System.in);' },
  { id: 'e-bad-import', head: 'import java.utils.ArrayList;\n', main: 'int x = 1;' },
  { id: 'e-prim-generic', head: LIST, main: 'ArrayList<int> a = new ArrayList<>();' },
  { id: 'e-unknown-var', main: 'x = 5;' },
  { id: 'e-unknown-var-2', main: 'int score = 1;\n    System.out.println(scroe);' },
  { id: 'e-out-of-scope', main: 'for (int i = 0; i < 2; i++) {\n      int x = i;\n    }\n    System.out.println(x);' },
  { id: 'e-out-of-scope-2', main: 'for (int i = 0; i < 2; i++) { }\n    System.out.println(i);' },
  { id: 'e-out-of-scope-3', main: 'if (args.length > 0) {\n      int y = 1;\n    }\n    y = 2;' },
  { id: 'e-other-method-var', files: { 'A.java': 'public class A {\n  public void a() { int n = 1; }\n  public void b() { n = 2; }\n}\n' } },
  { id: 'e-unknown-method', files: { 'A.java': 'public class A {\n  public void a() { go(); }\n}\n' } },
  { id: 'e-unknown-method-args', files: { 'A.java': 'public class A {\n  public void a() { go(1, "x", 2.5, true); }\n}\n' } },
  { id: 'e-unknown-method-obj', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    p.heal(5);\n  }\n}\n' } },
  { id: 'e-unknown-field-obj', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    p.score = 5;\n  }\n}\n' } },
  { id: 'e-private-field', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    p.health = -50;\n  }\n}\n' } },
  { id: 'e-private-read', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    System.out.println(p.name);\n  }\n}\n' } },
  { id: 'e-private-method', files: { 'A.java': 'public class A {\n  private void hide() { }\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    new A().hide();\n  }\n}\n' } },
  { id: 'e-private-ctor', files: { 'A.java': 'public class A {\n  private A() { }\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    new A();\n  }\n}\n' } },
  { id: 'e-string-to-int', main: 'int x = "5";' },
  { id: 'e-int-to-string', main: 'String s = 5;' },
  { id: 'e-double-to-int', main: 'int x = 2.5;' },
  { id: 'e-double-expr-to-int', main: 'double d = 1.5;\n    int x = d * 2;' },
  { id: 'e-long-to-int', main: 'long a = 1;\n    int b = a;' },
  { id: 'e-int-to-boolean', main: 'boolean b = 1;' },
  { id: 'e-boolean-to-int', main: 'int b = true;' },
  { id: 'e-string-to-char', main: 'char c = "a";' },
  { id: 'e-double-to-char', main: 'char c = 1.5;' },
  { id: 'e-int-to-char', main: 'int n = 65;\n    char c = n;' },
  { id: 'e-player-to-string', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    String s = new Player("A", 1);\n  }\n}\n' } },
  { id: 'e-void-to-int', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    int x = p.takeDamage(1);\n  }\n}\n' } },
  { id: 'e-void-print', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    System.out.println(p.takeDamage(1));\n  }\n}\n' } },
  { id: 'e-void-concat', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    String s = "x" + p.takeDamage(1);\n  }\n}\n' } },
  { id: 'e-ctor-args', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A");\n  }\n}\n' } },
  { id: 'e-ctor-no-args', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player();\n  }\n}\n' } },
  { id: 'e-ctor-swap', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player(1, "A");\n  }\n}\n' } },
  { id: 'e-default-ctor-args', files: { 'A.java': 'public class A {\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    A a = new A(1);\n  }\n}\n' } },
  { id: 'e-two-ctors', files: { 'A.java': 'public class A {\n  public A(int x) { }\n  public A(String s, int y) { }\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    A a = new A(true);\n  }\n}\n' } },
  { id: 'e-method-args', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    p.takeDamage();\n  }\n}\n' } },
  { id: 'e-method-arg-type', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    p.takeDamage("5");\n  }\n}\n' } },
  { id: 'e-method-too-many', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    p.takeDamage(1, 2);\n  }\n}\n' } },
  { id: 'e-overload-args', files: { 'A.java': 'public class A {\n  public void f(int x) { }\n  public void f(String s) { }\n  public void g() { f(true); }\n}\n' } },
  { id: 'e-lib-args', main: 'String s = "abc";\n    System.out.println(s.substring("x"));' },
  { id: 'e-lib-no-method', main: 'String s = "abc";\n    s.size();' },
  { id: 'e-length-field', main: 'String s = "abc";\n    System.out.println(s.length);' },
  { id: 'e-array-length-method', main: 'int[] a = new int[2];\n    System.out.println(a.length());' },
  { id: 'e-list-index', head: LIST, main: 'ArrayList<String> a = new ArrayList<>();\n    System.out.println(a[0]);' },
  { id: 'e-string-index', main: 'String a = "x";\n    System.out.println(a[0]);' },
  { id: 'e-int-index', main: 'int a = 1;\n    System.out.println(a[0]);' },
  { id: 'e-list-add-wrong', head: LIST, main: 'ArrayList<String> a = new ArrayList<>();\n    a.add(5);' },
  { id: 'e-dereference', main: 'int a = 1;\n    a.toString();' },
  { id: 'e-dereference-field', main: 'int a = 1;\n    System.out.println(a.x);' },
  { id: 'e-static-field', files: { 'A.java': 'public class A {\n  private int n;\n  public static void main(String[] args) {\n    n = 5;\n  }\n}\n' } },
  { id: 'e-static-method', files: { 'A.java': 'public class A {\n  public void go() { }\n  public static void main(String[] args) {\n    go();\n  }\n}\n' } },
  { id: 'e-static-this', files: { 'A.java': 'public class A {\n  public static void main(String[] args) {\n    System.out.println(this);\n  }\n}\n' } },
  { id: 'e-class-method-call', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player.takeDamage(5);\n  }\n}\n' } },
  { id: 'e-class-field-read', files: { 'A.java': 'public class A {\n  public int n;\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    System.out.println(A.n);\n  }\n}\n' } },
  { id: 'e-missing-return', files: { 'A.java': 'public class A {\n  public int f() {\n    int x = 1;\n  }\n}\n' } },
  { id: 'e-missing-return-if', files: { 'A.java': 'public class A {\n  public int f(int x) {\n    if (x > 0) {\n      return 1;\n    }\n  }\n}\n' } },
  { id: 'e-missing-return-while', files: { 'A.java': 'public class A {\n  public int f(int x) {\n    while (x > 0) {\n      return 1;\n    }\n  }\n}\n' } },
  { id: 'e-return-value-void', files: { 'A.java': 'public class A {\n  public void f() {\n    return 1;\n  }\n}\n' } },
  { id: 'e-return-ctor-value', files: { 'A.java': 'public class A {\n  public A() {\n    return 1;\n  }\n}\n' } },
  { id: 'e-return-none', files: { 'A.java': 'public class A {\n  public int f() {\n    return;\n  }\n}\n' } },
  { id: 'e-return-wrong-type', files: { 'A.java': 'public class A {\n  public int f() {\n    return "x";\n  }\n}\n' } },
  { id: 'e-return-lossy', files: { 'A.java': 'public class A {\n  public int f() {\n    return 2.5;\n  }\n}\n' } },
  { id: 'e-unreachable', main: 'return;\n    System.out.println("x");' },
  { id: 'e-unreachable-loop', main: 'while (true) {\n      int x = 1;\n    }\n    System.out.println("x");' },
  { id: 'e-unreachable-break', main: 'for (int i = 0; i < 2; i++) {\n      break;\n      System.out.println("x");\n    }' },
  { id: 'e-uninit', main: 'int x;\n    System.out.println(x);' },
  { id: 'e-uninit-if', main: 'int x;\n    if (args.length > 0) {\n      x = 1;\n    }\n    System.out.println(x);' },
  { id: 'e-uninit-loop', main: 'int x;\n    for (int i = 0; i < 2; i++) {\n      x = 1;\n    }\n    System.out.println(x);' },
  { id: 'e-uninit-plus', main: 'int x;\n    x += 1;' },
  { id: 'e-dup-local', main: 'int x = 1;\n    int x = 2;' },
  { id: 'e-dup-param', files: { 'A.java': 'public class A {\n  public void f(int x) {\n    int x = 2;\n  }\n}\n' } },
  { id: 'e-dup-loop', main: 'int i = 0;\n    for (int i = 0; i < 2; i++) { }' },
  { id: 'e-dup-ctor-param', files: { 'A.java': 'public class A {\n  public A(String t, int x) {\n    int x = 2;\n  }\n}\n' } },
  { id: 'e-dup-field', files: { 'A.java': 'public class A {\n  private int x;\n  private int x;\n}\n' } },
  { id: 'e-dup-method', files: { 'A.java': 'public class A {\n  public void f(int x) { }\n  public void f(int y) { }\n}\n' } },
  { id: 'e-dup-ctor', files: { 'A.java': 'public class A {\n  public A(int x) { }\n  public A(int y) { }\n}\n' } },
  { id: 'e-dup-class', files: { 'Main.java': 'class B { }\nclass B { }\npublic class Main { }\n' } },
  { id: 'e-wrong-file', files: { 'Main.java': 'public class Other {\n}\n' } },
  { id: 'e-bad-op', main: 'String s = "a" - 1;' },
  { id: 'e-bad-op-2', main: 'boolean b = true + 1;' },
  { id: 'e-bad-op-3', main: 'int x = 1;\n    if (x > 0 && 5) { }' },
  { id: 'e-bad-op-4', main: 'String a = "x";\n    if (a > "y") { }' },
  { id: 'e-bad-op-5', main: 'boolean b = !5;' },
  { id: 'e-bad-op-6', main: 'String s = "x";\n    s++;' },
  { id: 'e-bad-op-7', main: 'int x = -"a";' },
  { id: 'e-bad-compare', main: 'int a = 1;\n    String b = "x";\n    System.out.println(a == b);' },
  { id: 'e-bad-compare-2', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    String b = "x";\n    System.out.println(p == b);\n  }\n}\n' } },
  { id: 'e-bad-compare-3', main: 'int a = 1;\n    System.out.println(a == null);' },
  { id: 'e-compare-chain', main: 'int x = 5;\n    if (1 < x < 10) { }' },
  { id: 'e-final-local', main: 'final int x = 1;\n    x = 2;' },
  { id: 'e-final-field', files: { 'A.java': 'public class A {\n  private final int x = 1;\n  public void f() { x = 2; }\n}\n' } },
  { id: 'e-final-field-this', files: { 'A.java': 'public class A {\n  private final int x = 1;\n  public void f() { this.x = 2; }\n}\n' } },
  { id: 'e-final-unset', files: { 'A.java': 'public class A {\n  private final int x;\n  public A() { }\n}\n' } },
  { id: 'e-final-no-ctor', files: { 'A.java': 'public class A {\n  private final int x;\n}\n' } },
  { id: 'e-assign-to-call', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    p.getHealth() = 5;\n  }\n}\n' } },
  { id: 'e-assign-to-literal', main: '5 = 3;' },
  { id: 'e-bad-foreach', main: 'int a = 5;\n    for (int x : a) { }' },
  { id: 'e-foreach-type', main: 'String[] a = new String[1];\n    for (int x : a) { }' },
  { id: 'e-break-outside', main: 'break;' },
  { id: 'e-continue-outside', main: 'continue;' },
  { id: 'e-tostring-private', files: { 'A.java': 'public class A {\n  private String toString() { return "a"; }\n}\n' } },
  { id: 'e-tostring-noaccess', files: { 'A.java': 'public class A {\n  String toString() { return "a"; }\n}\n' } },
  { id: 'e-tostring-void', files: { 'A.java': 'public class A {\n  public void toString() { }\n}\n' } },
  { id: 'e-tostring-int', files: { 'A.java': 'public class A {\n  public int toString() { return 1; }\n}\n' } },
  { id: 'e-override-none', files: { 'A.java': 'public class A {\n  @Override\n  public String tostring() { return "a"; }\n}\n' } },
  { id: 'e-void-ctor', files: { 'Song.java': 'public class Song {\n  private String t;\n  public void Song(String t) { this.t = t; }\n}\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Song s = new Song("A");\n  }\n}\n' } },
  { id: 'e-sys-lower', main: 'system.out.println("x");' },
  { id: 'e-sys-out', main: 'System.Out.println("x");' },
  { id: 'e-sys-print', main: 'System.out.printn("x");' },
  { id: 'e-sys-no-out', main: 'System.println("x");' },
  { id: 'e-println-cap', main: 'System.out.PrintLn("x");' },
  { id: 'e-string-single', main: "String s = 'hello';" },
  { id: 'e-array-init-var', main: 'int x = { 1, 2 };' },
  { id: 'e-array-assign-braces', main: 'int[] a;\n    a = { 1, 2 };' },
  { id: 'e-array-of-string', main: 'int[] a = new String[2];' },
  { id: 'e-new-no-parens', files: { 'A.java': 'public class A { }\n', 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    A a = new A;\n  }\n}\n' } },
  { id: 'e-new-list-iface', head: LIST, main: 'List<String> a = new List<>();' },
  { id: 'e-new-math', main: 'Math m = new Math();' },
  { id: 'e-decl-under-if', main: 'if (args.length > 0)\n      int x = 1;' },
  { id: 'e-missing-field-type', files: { 'A.java': 'public class A {\n  private x;\n}\n' } },
  { id: 'e-param-no-type', files: { 'A.java': 'public class A {\n  public void f(x) { }\n}\n' } },
  { id: 'e-call-with-types', files: { 'A.java': 'public class A {\n  public void f(int x) { }\n  public void g() { f(int 5); }\n}\n' } },
  { id: 'e-this-in-static-call', files: { 'A.java': 'public class A {\n  private int n;\n  public static int f() { return this.n; }\n}\n' } },
  { id: 'e-cast-bad', main: 'String s = (String) 5;' },
  { id: 'e-cast-bad-2', main: 'int x = (int) "5";' },
  { id: 'e-cast-bad-3', main: 'boolean b = (boolean) 1;' },
  { id: 'e-mod-string', main: 'int x = 5 % "a";' },
  { id: 'e-no-main-sig', main: 'int 2x = 1;' },
  { id: 'e-equals-single', main: 'int x = 1;\n    if (x =! 2) { }' },
  { id: 'e-semicolon-after-class', files: { 'A.java': 'public class A; {\n}\n' } },
  { id: 'e-method-call-no-parens', files: { 'Player.java': PLAYER, 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    Player p = new Player("A", 1);\n    System.out.println(p.getHealth);\n  }\n}\n' } },
  { id: 'e-two-errors-attr-then-flow', files: { 'A.java': 'public class A {\n  public int f() {\n    int x = "s";\n  }\n}\n' } },
  { id: 'e-two-classes-order', files: { 'A.java': 'public class A {\n  public void f() { int x = "s"; }\n}\n', 'B.java': 'public class B {\n  public void f() { String y = 1; }\n}\n' } },
];
