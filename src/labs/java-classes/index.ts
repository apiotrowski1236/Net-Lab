import type { JavaCheck, JavaSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { GoalDef, LabDef } from '../types';
import * as code from './code';

/**
 * Write Your First Class (AP CSA, Unit 3). A lesson with no network: the stage
 * holds a Java editor (src/demos/java.ts), and src/java compiles and runs the
 * code in the browser. Plan: PLAN.md.
 */

/** A goal met when one of a demo's checks passes. */
const passed = (demo: string, check: JavaCheck, label: string, hint?: string): GoalDef => ({
  id: check.id,
  label,
  hint,
  check: demoFact(demo, (f) => f[`check:${check.id}`] === true),
});

const songChecks: JavaCheck[] = [code.SONG_FIELDS, code.SONG_CTOR, code.SONG_SETS];
const getterChecks: JavaCheck[] = [code.SONG_ACCESSORS, code.SONG_SUMMARY];
const mutatorChecks: JavaCheck[] = [code.SONG_PLAY, code.SONG_ADD];
const petChecks: JavaCheck[] = [code.PET_FIXED, code.PET_OLDER];
const bankChecks: JavaCheck[] = [code.BANK_FIELDS, code.BANK_CTOR, code.BANK_BALANCE, code.BANK_DEPOSIT, code.BANK_WITHDRAW, code.BANK_SUMMARY, code.BANK_MAIN];
const listChecks: JavaCheck[] = [code.LIST_ADD, code.LIST_TOTAL, code.LIST_MOST];

const songEditor: JavaSpec = { kind: 'java', id: 'song', title: 'Write the Song class', files: code.SONG_START, checks: songChecks };

export const javaClassesLab: LabDef = {
  id: 'java-classes',
  version: 1,
  title: 'Write Your First Class',
  tagline: 'See why programs need classes, watch objects get built one line at a time, then write your own Song and BankAccount classes.',
  // AP CSA Unit 3, Class Creation: topics 3.3, 3.4, 3.5, 3.8, and 3.9.
  unit: 3,
  codehs: [],
  ced: ['3.3.A', '3.4.A', '3.5.A', '3.8.A', '3.9.A'],
  minutes: 60,
  objectives: [
    'Explain what a class and an object are, and when a program should use a class',
    'Write private instance variables and a constructor that sets them',
    'Write accessor and mutator methods, and predict what calling them does',
    'Explain where a variable can be used, and use this when a parameter hides an instance variable',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'why',
      title: 'Too many variables',
      body: md`
        Programs keep track of things: players in a game, songs in an app, students in a class. In this lab you'll teach Java about a new kind of thing, by writing a **class**.

        First, see the problem a class solves. This code tracks two players in a game. Each player has a name and a health number, so each player needs two variables.

        1. Press **Run**. Read what it prints.
        2. Add a third player named Linus, with 90 health. Print Linus too, then press **Run** again.

        (This editor runs the parts of Java used in AP CSA, right in your browser. It will tell you if you use something it can't run.)
      `,
      demos: [{ kind: 'java', id: 'loose', title: 'Tracking players', files: code.LOOSE, checks: [code.THIRD_PLAYER] }],
      goals: [
        { id: 'ran', label: 'Run the code.', hint: 'Press the **Run** button above the code.', check: demoFact('loose', (f) => (f.runs as number) > 0) },
        passed('loose', code.THIRD_PLAYER, 'Add a third player named Linus, and print that player.', 'Copy the two lines for Grace, change the names to name3 and health3, then copy the print line too.'),
      ],
      questions: [
        {
          id: 'fifty',
          kind: 'choice',
          prompt: 'A real game has 50 players. Each player has a name, a health number, and a score. How many separate variables would this style of code need?',
          options: [
            { id: '3', text: '3', feedback: 'That covers one player. Each of the 50 players needs their own three.' },
            { id: '50', text: '50', feedback: 'That gives each player one variable, but each player has three values to keep.' },
            { id: '53', text: '53', feedback: 'The counts multiply. They do not add. Each of the 50 players has 3 values.' },
            { id: '150', text: '150', correct: true },
          ],
          explain: '50 players times 3 values is 150 variables, and nothing in the code says which name goes with which score. A class fixes both problems.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'what',
      title: 'Classes and objects',
      body: md`
        A **class** is a blueprint for one kind of thing. An **object** is one thing built from that blueprint. One class can make as many objects as you need.

        A class says two things about every object it makes:

        - **Attributes** are the data each object keeps. A player has a name and health.
        - **Behaviors** are what each object can do. A player can take damage.

        Try it. Press **new Player** to make two objects. Then press **takeDamage(10)** on only one of them, and watch the other.

        You already use a class. **String** is a class that comes with Java, and every piece of text is one String object. Each one has its own characters, and each can tell you its \`length()\`.

        **When should you write a class?**

        - You have data that belongs together, like a song's title, artist, and play count.
        - You need many of the same kind of thing: 30 students, 50 players, 1,000 songs.
        - You have rules to protect. A bank balance should never go below 0.
      `,
      demos: [
        {
          kind: 'objects',
          id: 'stamp',
          title: 'One class, many objects',
          cls: 'Player',
          hit: 10,
          make: [
            { name: 'ada', label: 'Ada', health: 100 },
            { name: 'grace', label: 'Grace', health: 80 },
            { name: 'linus', label: 'Linus', health: 90 },
          ],
        },
      ],
      goals: [
        { id: 'two', label: 'Make two objects from the Player class.', hint: 'Press **new Player** twice.', check: demoFact('stamp', (f) => (f.made as number) >= 2) },
        { id: 'separate', label: 'Hit one object, and leave another one alone.', hint: 'Press **takeDamage(10)** on one card only.', check: demoFact('stamp', (f) => f.separate === true) },
      ],
      questions: [
        {
          id: 'which',
          kind: 'choice',
          prompt: 'In the line `Player ada = new Player("Ada", 100);`, which word names the class?',
          options: [
            { id: 'player', text: 'Player', correct: true },
            { id: 'ada', text: 'ada', feedback: 'ada is a variable. It refers to one object.' },
            { id: 'new', text: 'new', feedback: 'new is the Java word that builds an object from a class.' },
            { id: 'text', text: '"Ada"', feedback: 'That is a String value, handed to the new object as its name.' },
          ],
          explain: 'Class names start with a capital letter by habit. This line says: make a new object from the Player class, and call it ada.',
        },
        {
          id: 'when',
          kind: 'choice',
          prompt: 'A music app tracks thousands of songs. Each has a title, an artist, and a play count. What is the best design?',
          options: [
            { id: 'vars', text: 'Three variables for each song', feedback: 'That is thousands of loose variables, the problem from step 1.' },
            { id: 'one', text: 'One Song class, and one object per song', correct: true },
            { id: 'many', text: 'One class per song: Song1, Song2, and so on', feedback: 'All songs have the same attributes, so one blueprint is enough. Each song is an object, not a class.' },
            { id: 'text', text: 'One long String holding every song', feedback: 'Then the program would have to dig through text to find one play count, and nothing keeps the data in order.' },
          ],
          explain: 'A class describes the kind of thing. Each song is an object, with its own title, artist, and play count.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'anatomy',
      title: 'Read a real class',
      body: md`
        Here is the Player class in real Java. Open the **Player.java** tab and find each part. Comments in the code name them too.

        | Part | What it does |
        | --- | --- |
        | \`public class Player\` | Starts the class. The file has the same name. |
        | **Instance variables** | The attributes. Every object gets its own copy. |
        | **Constructor** | Sets up a new object. It has the class's name and no return type. |
        | **Methods** | The behaviors. Other code calls them with a dot. |

        **Main.java** is a second class. Java starts every program at its \`main\` method. It uses the Player class the way you use String.

        Notice how much shorter Main is than your code from step 1. Now add Linus: one line makes the object, with the name "Linus" and 90 health. One more line prints it. Press **Run**.
      `,
      demos: [{ kind: 'java', id: 'players', title: 'Two classes working together', files: code.PLAYERS, checks: [code.THIRD_OBJECT] }],
      goals: [passed('players', code.THIRD_OBJECT, 'Make a third Player for Linus, and print it.', 'Copy the line that makes grace. Change the variable name, the name, and the health. Then copy a print line.')],
      questions: [
        {
          id: 'ctor',
          kind: 'choice',
          prompt: 'Which part of Player runs when Java reaches `new Player("Ada", 100)`?',
          options: [
            { id: 'ctor', text: 'The constructor', correct: true },
            { id: 'damage', text: 'takeDamage', feedback: 'A method runs only when code calls it with a dot, like ada.takeDamage(30).' },
            { id: 'main', text: 'main', feedback: 'main is where the program starts. It is already running, and it is the code that says new.' },
            { id: 'get', text: 'getHealth', feedback: 'A method runs only when code calls it with a dot, like ada.getHealth().' },
          ],
          explain: 'new builds the object, then the constructor runs once to set it up. The two values in parentheses go to the constructor\'s parameters.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'trace',
      title: 'Watch an object get built',
      body: md`
        Now watch the same code run one line at a time.

        Press **Step through**, then press **Next** again and again. The marked line is the one **about to run**.

        Watch for these:

        - **Variables** belong to the method that is running. A new box appears when a method starts, and goes away when it ends.
        - **Objects** don't go away when a method ends. The arrow shows that a variable holds a **reference**: where the object is, not the object itself.
        - Inside the constructor and takeDamage, \`this\` points at the object the code is working on.

        Press **Back** any time. Keep going until you reach the end of the program.
      `,
      demos: [{ kind: 'java', id: 'trace', title: 'One line at a time', files: code.TRACED, step: true }],
      goals: [{ id: 'end', label: 'Step through to the end of the program.', hint: 'Press **Step through**, then keep pressing **Next** until it stops.', check: demoFact('trace', (f) => f.finished === true) }],
      questions: [
        {
          id: 'default',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Press **Back** to the first step inside the constructor. The Ada object already exists. What is its health before the constructor sets it?',
          options: [
            { id: '0', text: '0', correct: true },
            { id: '100', text: '100', feedback: 'That comes one line later. Step back and look at the object before the constructor stores the value.' },
            { id: 'null', text: 'null', feedback: 'null is the default for references, like the String name. health is an int.' },
            { id: 'none', text: 'It has no value yet', feedback: 'Look at the object box. Java fills in a value as soon as the object exists.' },
          ],
          explain: 'Instance variables always start with a **default value**: 0 for int, 0.0 for double, false for boolean, and null for references. Then the constructor runs.',
        },
        {
          id: 'separate',
          kind: 'choice',
          afterGoals: true,
          prompt: 'What does `ada.takeDamage(30)` do to Grace\'s health?',
          options: [
            { id: 'nothing', text: 'Nothing. Grace is a separate object', correct: true },
            { id: 'same', text: 'It drops by 30, the same as Ada', feedback: 'Step to the end and compare the two objects. They share a class, not their data.' },
            { id: 'zero', text: 'It resets to 0, the default value', feedback: 'takeDamage only touches the object it was called on.' },
            { id: 'copy', text: 'It is set to match Ada\'s new health', feedback: 'Each object keeps its own health. Nothing copies one into the other.' },
          ],
          explain: 'Each object has its own instance variables. The dot says which object the method works on.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'private',
      title: 'Why private?',
      body: md`
        Player's instance variables say **private**. Only code inside the Player class can touch them. **public** means any class can use it.

        See what happens when Main tries to break the rule.

        1. In Main, where the comment says, type \`ada.health = -50;\` and press **Run**. Read the error. Java refused to compile this.
        2. Replace that line with \`ada.takeDamage(500);\` and press **Run**. Ada's health stops at 0, because takeDamage has an if that checks it.

        Keeping data private and offering public methods is called **data encapsulation**. The class guards its own rules. Other classes can't put an object in a bad state, like a player with -50 health.

        In AP CSA, classes and constructors are public, and instance variables are private.
      `,
      demos: [{ kind: 'java', id: 'guard', title: 'Try to break the rule', files: code.GUARDED, checks: [code.ENCAPSULATED] }],
      goals: [
        { id: 'blocked', label: 'See Java refuse `ada.health = -50;`', hint: 'Type the line exactly, with a semicolon, then press **Run**.', check: demoFact('guard', (f) => (f.errors as string).includes('private-access')) },
        passed('guard', code.ENCAPSULATED, 'Use takeDamage(500) instead, and see Ada stop at 0.', 'Replace the line that failed with: `ada.takeDamage(500);`'),
      ],
      questions: [
        {
          id: 'why',
          kind: 'choice',
          prompt: 'Why are Player\'s instance variables private?',
          options: [
            { id: 'rules', text: 'So only the class\'s own methods can change them', correct: true },
            { id: 'fast', text: 'So the program runs faster', feedback: 'private has no effect on speed. It is about which code is allowed to touch the data.' },
            { id: 'hidden', text: 'So not even Player\'s own methods can read them', feedback: 'Player\'s own methods can use them. takeDamage changes health. private stops other classes.' },
            { id: 'required', text: 'Because Java refuses to compile public variables', feedback: 'Java allows public instance variables. Programmers keep them private on purpose.' },
          ],
          explain: 'With private data, takeDamage is the only way to lower health, so one if statement protects every player in the program.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'fields-ctor',
      title: 'Your first class: Song',
      body: md`
        Now you write the class. Each song in a music app has a title, an artist, and a play count.

        Press **Run** first. You'll get an error, because Main calls a constructor that doesn't exist yet. That's fine. Errors are how you'll know what's left.

        Open **Song.java**.

        1. Declare three private instance variables: \`title\` and \`artist\` are Strings, and \`plays\` is an int. Follow the pattern in Player: \`private String name;\`
        2. Write a constructor. Give it two String parameters, \`songTitle\` and \`songArtist\`. Inside it, store each parameter in its instance variable, and set \`plays\` to 0.

        A **parameter** is a variable that receives a value from the code that calls. Main passes "Neon Rain", so inside the constructor, \`songTitle\` holds "Neon Rain".

        Press **Run** after each part. The checks under the editor tell you what's left.
      `,
      demos: [songEditor],
      goals: [
        passed('song', code.SONG_FIELDS, 'Declare the three private instance variables.', 'Inside the class, above the constructor: `private String title;` and so on. Each line ends with a semicolon.'),
        passed('song', code.SONG_CTOR, 'Write the constructor.', 'A constructor has the class name and no return type: `public Song(String songTitle, String songArtist) { }`'),
        passed('song', code.SONG_SETS, 'Store both values, and start plays at 0.', 'Inside the constructor: `title = songTitle;`'),
      ],
      questions: [
        {
          id: 'default-ctor',
          kind: 'choice',
          prompt: 'Suppose a class has no constructor at all. What does `new Song()` do?',
          options: [
            { id: 'default', text: 'Java supplies a default constructor', correct: true },
            { id: 'error', text: 'It fails to compile, since Song has no constructor', feedback: 'It compiles if the class has no constructor of its own. You saw a failure in this step because Main passed in two values.' },
            { id: 'null', text: 'It gives back null instead of an object', feedback: 'new always builds an object. It never gives back null.' },
            { id: 'ask', text: 'Java asks the user to type in the values', feedback: 'Java never asks. Every variable gets a value from the code, or a default.' },
          ],
          explain: 'With no constructor, Java supplies a **default constructor**. Once you write any constructor, Java stops supplying that one, which is why Main needed yours.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'getters',
      title: 'Accessors: let others read',
      body: md`
        Song's data is private, so Main can't read it. An **accessor** is a method that gives a copy of a value to other classes. It has a return type, and it ends with \`return\`:

        \`\`\`java
        public int getHealth() {
          return health;
        }
        \`\`\`

        The word before the name, \`int\`, is the **return type**: what kind of value the method gives back. \`return\` ends the method and hands the value to the code that called it.

        Your code from the last step is in **Song.java**. Add four methods below the constructor:

        1. \`getTitle()\`, which returns the title
        2. \`getArtist()\`, which returns the artist
        3. \`getPlays()\`, which returns the plays
        4. \`getSummary()\`, which returns one String built with \`+\`, like this: \`Neon Rain by The Tin Owls, 0 plays\`
      `,
      demos: [{ kind: 'java', id: 'song', title: 'Add accessors to Song', files: code.SONG_GETTERS, from: { step: 'fields-ctor', demo: 'song', files: ['Song.java'] }, checks: getterChecks }],
      goals: [
        passed('song', code.SONG_ACCESSORS, 'Write getTitle, getArtist, and getPlays.', 'getPlays gives back an int, so it starts: `public int getPlays()`'),
        passed('song', code.SONG_SUMMARY, 'Write getSummary.', '`return title + " by " + artist + ", " + plays + " plays";`'),
      ],
      questions: [
        {
          id: 'caller',
          kind: 'choice',
          prompt: 'Where does the value go when `getPlays()` runs `return plays;`?',
          options: [
            { id: 'caller', text: 'Back to the code that called the method', correct: true },
            { id: 'screen', text: 'To the screen, where the user can read it', feedback: 'return prints nothing. Only System.out.println prints. In Main, the print line is what shows the value.' },
            { id: 'var', text: 'Into the instance variable plays', feedback: 'plays stays the same. return hands back a copy of its value.' },
            { id: 'gone', text: 'Nowhere, since return ends the program', feedback: 'return ends only this method. Then the calling code continues.' },
          ],
          explain: 'A method call stands for the value it returns. In `System.out.println(first.getTitle());` the returned title is what gets printed.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'mutators',
      title: 'Mutators: let others change',
      body: md`
        An **accessor** reads. A **mutator** is a method that changes an instance variable. It is often **void**, which means it gives nothing back. \`takeDamage\` is a mutator.

        A song's play count goes up each time someone plays it. Add two mutators to **Song.java**:

        1. \`public void play()\` adds 1 to plays.
        2. \`public void addPlays(int amount)\` adds \`amount\` to plays.

        Main already calls both. Press **Run** to see the counts change. Each call changes only the object before the dot.
      `,
      demos: [{ kind: 'java', id: 'song', title: 'Add mutators to Song', files: code.SONG_MUTATORS, from: { step: 'getters', demo: 'song', files: ['Song.java'] }, checks: mutatorChecks, step: true, report: true }],
      goals: [
        passed('song', code.SONG_PLAY, 'Write play().', '`plays = plays + 1;`'),
        passed('song', code.SONG_ADD, 'Write addPlays(int amount).', '`plays = plays + amount;`'),
      ],
      questions: [
        {
          id: 'void',
          kind: 'choice',
          prompt: 'What happens with the line `int n = first.play();`?',
          options: [
            { id: 'error', text: 'It won\'t compile, since play is void', correct: true },
            { id: 'count', text: 'n gets the new play count', feedback: 'play would need a return type of int and a return line for that.' },
            { id: 'zero', text: 'n gets 0, since nothing came back', feedback: 'Java does not fill in a value. A void method has no value at all, so this does not compile.' },
            { id: 'null', text: 'n gets null, since nothing came back', feedback: 'An int can never hold null, and a void method gives back nothing.' },
          ],
          explain: 'Try it if you like: Java says incompatible types: void cannot be converted to int.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'this',
      title: 'Bug hunt: this',
      body: md`
        Someone wrote this Pet class. Press **Run**, and look at what it prints. The constructor looks right, but nothing was stored.

        Here is why. A **local variable** can only be used in the block that declares it, and a parameter counts as one. An instance variable can be used anywhere in the class. That range of where a name works is its **scope**.

        Here the parameter and the instance variable are both called \`name\`. Inside the constructor, \`name\` means the parameter, which **hides** the instance variable. So \`name = name;\` copies the parameter onto itself. Press **Step through** to watch nothing change.

        **this** refers to the current object, the one the code is working on. \`this.name\` always means the instance variable.

        1. Fix the constructor: \`this.name = name;\` and the same for age.
        2. Write \`public boolean isOlderThan(Pet other)\`. It returns true when \`this.age\` is greater than \`other.age\`. Private data is open to code in the same class, even on another Pet.
      `,
      demos: [{ kind: 'java', id: 'pets', title: 'Fix the Pet class', files: code.PET, checks: petChecks, step: true, report: true }],
      goals: [
        passed('pets', code.PET_FIXED, 'Fix the constructor with this.', '`this.name = name;`'),
        passed('pets', code.PET_OLDER, 'Write isOlderThan.', '`return this.age > other.age;`'),
      ],
      questions: [
        {
          id: 'scope',
          kind: 'choice',
          prompt: 'Pet\'s constructor has a parameter `age`. Can `getSummary` use that parameter?',
          options: [
            { id: 'no', text: 'No. It exists only in the constructor', correct: true },
            { id: 'yes', text: 'Yes. Any code in the class can use it', feedback: 'That is true of instance variables. A parameter is a local variable, so it ends when the constructor ends.' },
            { id: 'public', text: 'Only if the parameter is public', feedback: 'Local variables and parameters can\'t be public or private at all.' },
            { id: 'this', text: 'Yes, if it writes this.age', feedback: 'this.age is the instance variable. That works, but it is not the parameter.' },
          ],
          explain: 'getSummary uses the instance variable age. That is why the constructor has to store the parameter there.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'scratch',
      title: 'From scratch: BankAccount',
      body: md`
        This time there's no pattern to copy. Write the whole class yourself in **BankAccount.java**.

        | Part | What it needs |
        | --- | --- |
        | Instance variables | \`owner\`, a String, and \`balance\`, an int. Both private. |
        | Constructor | Takes the owner and the starting balance. |
        | \`getBalance()\` | Returns the balance. |
        | \`deposit(int amount)\` | Adds to the balance. |
        | \`withdraw(int amount)\` | Subtracts from the balance, but only if there's enough. If not, the balance doesn't change. |
        | \`getSummary()\` | Returns text like \`Ada: $50\` |

        Then, in **Main.java**, make two accounts. Deposit into one, withdraw from the other, and print the summary of both.

        Build it one part at a time, and press **Run** after each one.
      `,
      demos: [{ kind: 'java', id: 'bank', title: 'Write the BankAccount class', files: code.BANK, checks: bankChecks, step: true, report: true }],
      goals: [
        passed('bank', code.BANK_CTOR, 'Write the instance variables and the constructor.', 'Song is your pattern: private instance variables, then a constructor with no return type.'),
        passed('bank', code.BANK_WITHDRAW, 'Write getBalance, deposit, and withdraw.', 'In withdraw, use an if: `if (amount <= balance) { ... }`'),
        passed('bank', code.BANK_SUMMARY, 'Write getSummary.', '`return owner + ": $" + balance;`'),
        passed('bank', code.BANK_MAIN, 'Use two accounts in Main.', '`BankAccount a = new BankAccount("Ada", 50);` and so on. Then call the methods on each one.'),
      ],
      questions: [
        {
          id: 'where-rule',
          kind: 'choice',
          prompt: 'Why does the "not below 0" rule go inside withdraw, not in Main?',
          options: [
            { id: 'once', text: 'So it protects every account in any program', correct: true },
            { id: 'must', text: 'Because Main can\'t contain an if statement', feedback: 'Main can use if. But then every program that uses BankAccount would have to remember the rule.' },
            { id: 'faster', text: 'Because code in a class runs faster', feedback: 'Speed is the same. The point is where the rule lives.' },
            { id: 'private', text: 'Because if statements have to be in private methods', feedback: 'withdraw is public, and an if can go in any method.' },
          ],
          explain: 'The class guards its own data. That is data encapsulation at work: one rule, in one place, for every object.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Think back to step 1, when you tracked players with loose variables. Your answer below goes to your teacher.
      `,
      questions: [
        {
          id: 'why-class',
          kind: 'text',
          prompt: 'A friend is writing a game with 20 enemies. Explain why they should write an Enemy class. Use the words object, instance variable, and private, and say what a constructor would do.',
          minWords: 40,
          lines: 5,
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.

        Finished early? After you hand in, press **Extra credit** for one more step: a class that holds a list of your Song objects.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'playlist',
      title: 'Extra credit: a Playlist',
      extra: true,
      body: md`
        A class can use other classes. A Playlist **has** Songs, which is called a **has-a** relationship. Its instance variable is an ArrayList of Song objects.

        Open **Playlist.java** and add three methods:

        1. \`public void add(Song song)\` puts a song on the list.
        2. \`public int getTotalPlays()\` adds up \`getPlays()\` for every song.
        3. \`public Song getMostPlayed()\` returns the song with the most plays. You can assume the list has at least one song.

        Use a for-each loop: \`for (Song s : songs)\`. Your methods can only reach a Song's private data through its public methods, the same as any other class.
      `,
      demos: [{ kind: 'java', id: 'list', title: 'Write the Playlist class', files: code.PLAYLIST, checks: listChecks, step: true, report: true, from: { step: 'mutators', demo: 'song', files: ['Song.java'] } }],
      goals: [
        passed('list', code.LIST_ADD, 'Write add.', '`songs.add(song);`'),
        passed('list', code.LIST_TOTAL, 'Write getTotalPlays.', 'Start a total at 0, then add each song\'s getPlays() in a for-each loop.'),
        passed('list', code.LIST_MOST, 'Write getMostPlayed.', 'Keep the best song so far in a variable. Start it at songs.get(0), and replace it when a song has more plays.'),
      ],
    },
  ],
};

