# Write Your First Class (AP CSA, Unit 3)

Status: built. Code in `index.ts`, `code.ts` (starting code and hidden checks), and `solution.ts`. The student panel reviews it.

CED: 3.3.A, 3.4.A, 3.5.A, 3.8.A, 3.9.A. Target: 60 minutes for an average student. The student panel's final median was 72 minutes (range 58 to 95), so `minutes` is 70.

Overriding `toString` is excluded from the course (CED 1.15.A.5), so the lab uses `getSummary()`, an ordinary method that returns a String.

Constructor parameters end in In (`songTitleIn`), the class's convention. Pet leaves it off on purpose, because step 9 is about a parameter hiding an instance variable.

| # | Step | Min | What the student does |
| --- | --- | --- | --- |
| 1 | why | 5 | Adds a third player with loose variables, then counts what 50 players would take |
| 2 | what | 4 | Makes Player objects from a class, hits one, and sees the other stay the same |
| 3 | anatomy | 7 | Opens Player.java, adds a third object in Main, and answers a question only Player.java can settle |
| 4 | trace | 6 | Steps through object creation and watches references and default values |
| 5 | private | 4 | Gets a private access error, then goes through the method |
| 6 | fields-ctor | 8 | Writes Song's instance variables and constructor |
| 7 | getters | 6 | Adds getPlays and getSummary |
| 8 | mutators | 4 | Reads takeDamage, then adds addPlays |
| 9 | this | 6 | Fixes a hidden-parameter bug with this |
| 10 | scratch | 11 | Writes BankAccount from a list of parts. Main is given, so the class gets the time. |
| 11 | reflect | 2 | Explains why a game needs an Enemy class |
| 12 | submit | | Hands in |
| 13 | playlist | extra | Writes a Playlist that has an ArrayList of Song |

The runner is a compiler and interpreter for the Java subset AP CSA uses (`src/java`). `src/java/differential.test.ts` compares it with a real JDK through `scripts/java-oracle/Oracle.java`, and skips itself where `javac` isn't installed.

## Step-through animation

The interpreter records what each line does as `beats` on its trace step (`src/java/run.ts`). `planStep` in `src/demos/javaPlan.ts` turns one step and the next into a timed plan, and `Stepper` in `src/ui/demos/Java.tsx` plays it on a loop until the student moves on. A for loop's update and a for-each's next item belong to the loop's own line.

**Pause** and `prefers-reduced-motion` hold the picture on the line's finished work, with the action written out in the strip. The caption says the same action in sentences, so nothing depends on watching the motion.
