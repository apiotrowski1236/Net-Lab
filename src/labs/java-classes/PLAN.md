# Write Your First Class (AP CSA, Unit 3)

Status: built. Code in `index.ts`, `code.ts` (starting code and hidden checks), and `solution.ts`. The student panel has not run yet.

CED: 3.3.A, 3.4.A, 3.5.A, 3.8.A, 3.9.A. Target: 60 minutes for an average student.

Overriding `toString` is excluded from the course (CED 1.15.A.5), so the lab uses `getSummary()`, an ordinary method that returns a String.

| # | Step | Min | What the student does |
| --- | --- | --- | --- |
| 1 | why | 5 | Adds a third player with loose variables, then counts what 50 players would take |
| 2 | what | 5 | Makes Player objects from a class, hits one, and sees the other stay the same |
| 3 | anatomy | 6 | Reads a real Player class, then adds a third object in Main |
| 4 | trace | 6 | Steps through object creation and watches references and default values |
| 5 | private | 4 | Gets a private access error, then goes through the method |
| 6 | fields-ctor | 8 | Writes Song's instance variables and constructor |
| 7 | getters | 6 | Adds accessors and getSummary |
| 8 | mutators | 5 | Adds play and addPlays |
| 9 | this | 5 | Fixes a hidden-parameter bug with this, and writes isOlderThan |
| 10 | scratch | 9 | Writes BankAccount from a table of parts |
| 11 | reflect | 2 | Explains why a game needs an Enemy class |
| 12 | submit | | Hands in |
| 13 | playlist | extra | Writes a Playlist that has an ArrayList of Song |

The runner is a compiler and interpreter for the Java subset AP CSA uses (`src/java`). `src/java/differential.test.ts` compares it with a real JDK through `scripts/java-oracle/Oracle.java`, and skips itself where `javac` isn't installed.
